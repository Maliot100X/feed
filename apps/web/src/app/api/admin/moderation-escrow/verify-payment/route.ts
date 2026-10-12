/**
 * Admin Moderation Escrow Verify Payment API
 *
 * @route POST /api/admin/moderation-escrow/verify-payment - Verify payment
 * @access Admin with manage_escrow permission (SUPER_ADMIN by default)
 *
 * @description
 * Verifies that an escrow payment was completed on-chain. Checks transaction
 * hash and updates payment status. Uses X402 manager for verification.
 *
 * @openapi
 * /api/admin/moderation-escrow/verify-payment:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Verify escrow payment
 *     description: Verifies on-chain payment completion (admin only)
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
 *               - txHash
 *             properties:
 *               escrowId:
 *                 type: string
 *               txHash:
 *                 type: string
 *                 description: On-chain transaction hash
 *     responses:
 *       200:
 *         description: Payment verified successfully
 *       400:
 *         description: Invalid escrow or transaction
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * await fetch('/api/admin/moderation-escrow/verify-payment', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` },
 *   body: JSON.stringify({
 *     escrowId: 'escrow-id',
 *     txHash: '0x...'
 *   })
 * });
 * ```
 */

import { escrowErrorHttpStatus, verifyEscrowPayment } from '@feed/a2a';
import { requirePermission, withErrorHandling } from '@feed/api';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const VerifyEscrowPaymentSchema = z.object({
  escrowId: z.string().min(1, 'Escrow ID is required'),
  txHash: z.string().min(1, 'Transaction hash is required'),
  fromAddress: z.string().min(1, 'From address is required'),
  toAddress: z.string().min(1, 'To address is required'),
  amount: z.string().min(1, 'Amount is required'),
});

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const adminUser = await requirePermission(req, 'manage_escrow');
  const adminId = adminUser.userId;

  const body = await req.json();
  const validation = VerifyEscrowPaymentSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        error: validation.error.issues[0]?.message || 'Invalid request data',
      },
      { status: 400 }
    );
  }

  const { escrowId, txHash } = validation.data;
  const result = await verifyEscrowPayment(validation.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: escrowErrorHttpStatus(result.code) }
    );
  }
  const verifiedEscrow = result.value;

  logger.info(
    `Escrow payment verified successfully for ${escrowId}`,
    {
      escrowId,
      recipientId: verifiedEscrow.recipientId,
      amountUSD: verifiedEscrow.amountUSD,
      txHash,
      adminId,
    },
    'ModerationEscrow'
  );

  return NextResponse.json({
    success: true,
    escrow: {
      id: verifiedEscrow.id,
      recipientId: verifiedEscrow.recipientId,
      amountUSD: verifiedEscrow.amountUSD,
      status: verifiedEscrow.status,
      paymentTxHash: verifiedEscrow.paymentTxHash,
    },
  });
});
