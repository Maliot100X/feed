/**
 * Admin Notifications API
 *
 * @route POST /api/admin/notifications - Create notification
 * @access Admin
 *
 * @description
 * Creates and sends a notification to a specific user or all users.
 * Supports various notification types. Exactly one target is required:
 * `userId` for a single user or `sendToAll: true` for a broadcast. Admin only.
 *
 * @openapi
 * /api/admin/notifications:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Create notification
 *     description: Sends notification to user or all users (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               userId:
 *                 type: string
 *                 description: Target user ID (required unless sendToAll is true; cannot be combined with sendToAll)
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 500
 *               type:
 *                 type: string
 *                 enum: [system, comment, reaction, follow, mention, reply, share]
 *                 default: system
 *               postId:
 *                 type: string
 *               commentId:
 *                 type: string
 *               sendToAll:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Notification created successfully
 *       400:
 *         description: Invalid input, both/neither target given, or target is a game actor
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found (if userId specified)
 *
 * @example
 * ```typescript
 * await fetch('/api/admin/notifications', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` },
 *   body: JSON.stringify({
 *     message: 'System maintenance scheduled',
 *     type: 'system',
 *     sendToAll: true
 *   })
 * });
 * ```
 */

import {
  createNotification,
  errorResponse,
  NotFoundError,
  requireAdmin,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { db } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

const CreateNotificationSchema = z
  .object({
    userId: z.string().trim().min(1).optional(),
    message: z.string().min(1).max(500),
    type: z
      .enum([
        'system',
        'comment',
        'reaction',
        'follow',
        'mention',
        'reply',
        'share',
      ])
      .default('system'),
    postId: z.string().optional(),
    commentId: z.string().optional(),
    sendToAll: z.boolean().default(false), // Send to all users
  })
  .refine((body) => Boolean(body.userId) !== body.sendToAll, {
    message: 'Provide exactly one of userId or sendToAll: true',
  });

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Require admin authentication
  const adminUser = await requireAdmin(request);

  // Parse request body
  const parsed = CreateNotificationSchema.safeParse(await request.json());
  if (!parsed.success) {
    return errorResponse(
      parsed.error.issues[0]?.message ?? 'Invalid request body',
      'VALIDATION_ERROR',
      400
    );
  }
  const { userId, message, type, postId, commentId, sendToAll } = parsed.data;

  logger.info(
    'Admin creating notification',
    {
      adminUserId: adminUser.userId,
      targetUserId: userId,
      sendToAll,
      type,
    },
    'POST /api/admin/notifications'
  );

  if (sendToAll) {
    // Send notification to all users
    const users = await db.user.findMany({
      where: {
        isActor: false, // Don't send to NPCs/actors
        isBanned: false, // Don't send to banned users
      },
      select: {
        id: true,
      },
    });

    // Send notifications in batches to avoid overwhelming the database.
    // Count actual outcomes instead of claiming every recipient succeeded.
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const batchSize = 50;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((user) =>
          createNotification({
            userId: user.id,
            type,
            message,
            title: 'Notification',
            postId,
            commentId,
          })
        )
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failed++;
          logger.warn(
            'Failed to send notification to user',
            { error: result.reason, userId: batch[index]?.id },
            'POST /api/admin/notifications'
          );
        } else if (result.value.created) {
          sent++;
        } else {
          skipped++;
        }
      });
    }

    logger.info(
      'Admin notification broadcast finished',
      {
        adminUserId: adminUser.userId,
        userCount: users.length,
        sent,
        skipped,
        failed,
      },
      'POST /api/admin/notifications'
    );

    return successResponse({
      success: failed === 0,
      message: `Notification sent to ${sent} of ${users.length} users${failed > 0 ? ` (${failed} failed)` : ''}`,
      recipientCount: users.length,
      sentCount: sent,
      skippedCount: skipped,
      failedCount: failed,
    });
  }
  if (userId) {
    // Send notification to specific user
    const targetUser = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActor: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundError('User', userId);
    }

    if (targetUser.isActor) {
      return errorResponse(
        'Cannot send notifications to game actors/NPCs',
        'INVALID_TARGET',
        400
      );
    }

    const result = await createNotification({
      userId: targetUser.id,
      type,
      message,
      title: 'Notification',
      postId,
      commentId,
    });

    logger.info(
      'Admin notification sent to user',
      {
        adminUserId: adminUser.userId,
        targetUserId: userId,
        targetUsername: targetUser.username,
      },
      'POST /api/admin/notifications'
    );

    return successResponse({
      success: result.created,
      message: result.created
        ? `Notification sent to ${targetUser.displayName}`
        : 'Notification was not created (duplicate within dedupe window or recipient unavailable)',
      recipient: {
        id: targetUser.id,
        username: targetUser.username,
        displayName: targetUser.displayName,
      },
    });
  }
  // Unreachable: the schema requires exactly one target.
  return errorResponse(
    'Provide exactly one of userId or sendToAll: true',
    'VALIDATION_ERROR',
    400
  );
});
