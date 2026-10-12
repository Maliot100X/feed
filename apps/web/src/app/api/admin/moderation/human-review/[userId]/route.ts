/**
 * Admin Moderation Human Review Process API
 *
 * @route POST /api/admin/moderation/human-review/[userId] - Process appeal
 * @access Admin
 *
 * @description
 * Processes an individual user appeal. Approves or denies the appeal with
 * reasoning. Approving unban restores user and refunds stake. Denying
 * keeps user banned and may transfer stake.
 *
 * @openapi
 * /api/admin/moderation/human-review/{userId}:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Process user appeal
 *     description: Approves or denies user appeal (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to process appeal for
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - reasoning
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, deny]
 *               reasoning:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Appeal processed successfully
 *       400:
 *         description: Invalid action or reasoning
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       409:
 *         description: Appeal is not (or no longer) in human review
 *
 * @example
 * ```typescript
 * await fetch(`/api/admin/moderation/human-review/${userId}`, {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` },
 *   body: JSON.stringify({
 *     action: 'approve',
 *     reasoning: 'Appeal approved after review'
 *   })
 * });
 * ```
 */

import {
  createNotification,
  errorResponse,
  requireAdmin,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import {
  and,
  db,
  eq,
  type JsonValue,
  type Transaction,
  users,
  withTransaction,
} from '@feed/db';
import { WalletService } from '@feed/engine';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

const HumanReviewActionSchema = z.object({
  action: z.enum(['approve', 'deny']),
  reasoning: z.string().trim().min(10).max(2000),
});

const inHumanReview = (userId: string) =>
  and(eq(users.id, userId), eq(users.appealStatus, 'human_review'));

/**
 * Atomically claim a pending human review for approval: lock the user row
 * while it is still in `human_review`, restore the account, clear the stake
 * flags and credit the stake refund in the same transaction. Concurrent or
 * repeated approvals find no row in `human_review` and credit nothing; a
 * credit failure rolls back the approval so it can be retried.
 */
async function approveAppeal(
  tx: Transaction,
  userId: string,
  reviewerId: string,
  reasoning: string
): Promise<boolean> {
  const [locked] = await tx
    .select({
      appealStaked: users.appealStaked,
      appealStakeAmount: users.appealStakeAmount,
      falsePositiveHistory: users.falsePositiveHistory,
    })
    .from(users)
    .where(inHumanReview(userId))
    .limit(1)
    .for('update');

  if (!locked) return false;

  const reviewedAt = new Date();
  const history: JsonValue[] = Array.isArray(locked.falsePositiveHistory)
    ? [...locked.falsePositiveHistory]
    : [];
  history.push({
    date: reviewedAt.toISOString(),
    reason: reasoning,
    reviewedBy: reviewerId,
    type: 'human_review',
  });

  await tx
    .update(users)
    .set({
      isBanned: false,
      isScammer: false,
      isCSAM: false,
      bannedAt: null,
      bannedBy: null,
      bannedReason: null,
      appealStatus: 'approved',
      appealReviewedAt: reviewedAt,
      falsePositiveHistory: history,
      appealStaked: false,
      appealStakeAmount: null,
      // appealStakeTxHash is kept so the same escrow payment cannot fund (and be
      // refunded for) a later appeal; /api/moderation/appeal checks it for reuse.
    })
    .where(inHumanReview(userId));

  const stakeAmount = Number(locked.appealStakeAmount);
  if (locked.appealStaked && stakeAmount > 0) {
    await WalletService.credit(
      userId,
      stakeAmount,
      'appeal_stake_refund',
      'Appeal stake refund - account restored via human review',
      undefined,
      tx
    );
    logger.info(
      'Appeal stake refunded',
      { userId, stakeAmount },
      'HumanReview'
    );
  }

  return true;
}

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ userId: string }> }
  ) => {
    const adminUser = await requireAdmin(request);
    const { userId } = await context.params;

    const body = await request.json();
    const { action, reasoning } = HumanReviewActionSchema.parse(body);

    if (action === 'approve') {
      const approved = await withTransaction((tx) =>
        approveAppeal(tx, userId, adminUser.userId, reasoning)
      );
      if (!approved) {
        return errorResponse(
          'Appeal not in human review',
          'APPEAL_NOT_IN_REVIEW',
          409
        );
      }

      await createNotification({
        userId,
        type: 'system',
        title: 'Appeal Approved - Account Restored',
        message: `A moderator reviewed your appeal and restored your account. ${reasoning}`,
      });

      logger.info(
        'Human review approved',
        {
          userId,
          adminUserId: adminUser.userId,
          reasoning,
        },
        'HumanReview'
      );

      return successResponse({
        success: true,
        message: 'Appeal approved - account restored',
      });
    }

    // Deny - permanent ban. Compare-and-set on the pending review state so a
    // deny cannot overwrite a concurrent approval.
    const denied = await db
      .update(users)
      .set({
        appealStatus: 'denied',
        appealReviewedAt: new Date(),
        // Keep banned, scammer, CSAM flags
      })
      .where(inHumanReview(userId))
      .returning({ id: users.id });
    if (denied.length === 0) {
      return errorResponse(
        'Appeal not in human review',
        'APPEAL_NOT_IN_REVIEW',
        409
      );
    }

    await createNotification({
      userId,
      type: 'system',
      title: 'Appeal Denied - Permanent Ban',
      message: `After human review, your appeal was denied. ${reasoning}`,
    });

    logger.info(
      'Human review denied',
      {
        userId,
        adminUserId: adminUser.userId,
        reasoning,
      },
      'HumanReview'
    );

    return successResponse({
      success: true,
      message: 'Appeal denied - permanent ban confirmed',
    });
  }
);
