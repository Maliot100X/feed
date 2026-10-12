/**
 * Admin Moderation Escrow Refund API
 *
 * @route POST /api/admin/moderation-escrow/refund - Refund payment
 * @access Admin with manage_escrow permission (SUPER_ADMIN by default)
 *
 * @description
 * Refunds an escrow payment back to the recipient. Requires refund transaction
 * hash for on-chain verification. Updates payment status to refunded.
 *
 * @openapi
 * /api/admin/moderation-escrow/refund:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Refund escrow payment
 *     description: Refunds payment back to recipient (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - escrowId
 *               - refundTxHash
 *             properties:
 *               escrowId:
 *                 type: string
 *               refundTxHash:
 *                 type: string
 *                 description: Refund transaction hash
 *               reason:
 *                 type: string
 *                 description: Optional refund reason
 *     responses:
 *       200:
 *         description: Refund processed successfully
 *       400:
 *         description: Invalid escrow or transaction
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * await fetch('/api/admin/moderation-escrow/refund', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` },
 *   body: JSON.stringify({
 *     escrowId: 'escrow-id',
 *     refundTxHash: '0x...',
 *     reason: 'Payment error'
 *   })
 * });
 * ```
 */

import { escrowErrorHttpStatus, refundEscrowPayment } from '@feed/a2a';
import { requirePermission, withErrorHandling } from '@feed/api';
import { logger, toISOOrNull } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const RefundEscrowSchema = z.object({
  escrowId: z.string().min(1, 'Escrow ID is required'),
  refundTxHash: z.string().min(1, 'Refund transaction hash is required'),
  reason: z.string().optional(),
});

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const _adminUser = await requirePermission(req, 'manage_escrow');
  const adminId = _adminUser.userId;

  const body = await req.json();
  const validation = RefundEscrowSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        error: validation.error.issues[0]?.message || 'Invalid request data',
      },
      { status: 400 }
    );
  }

  const { escrowId, refundTxHash, reason } = validation.data;

  const result = await refundEscrowPayment({
    escrowId,
    refundTxHash,
    reason,
    refundedBy: adminId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: escrowErrorHttpStatus(result.code) }
    );
  }
  const updatedEscrow = result.value;

  logger.info(
    `Admin ${adminId} refunded escrow payment ${escrowId}`,
    {
      adminId,
      escrowId,
      recipientId: updatedEscrow.recipientId,
      amountUSD: updatedEscrow.amountUSD,
      refundTxHash,
      reason,
    },
    'ModerationEscrow'
  );

  return NextResponse.json({
    success: true,
    escrow: {
      id: updatedEscrow.id,
      recipientId: updatedEscrow.recipientId,
      amountUSD: updatedEscrow.amountUSD,
      status: updatedEscrow.status,
      refundTxHash: updatedEscrow.refundTxHash,
      refundedAt: toISOOrNull(updatedEscrow.refundedAt),
    },
  });
});
