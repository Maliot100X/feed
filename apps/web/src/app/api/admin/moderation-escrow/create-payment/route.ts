/**
 * Admin Moderation Escrow Create Payment API
 *
 * @route POST /api/admin/moderation-escrow/create-payment - Create escrow payment
 * @access Admin with manage_escrow permission (SUPER_ADMIN by default)
 *
 * @description
 * Creates a moderation escrow payment request using X402 escrow system.
 * Admin can send money to users with escrow protection. Returns payment
 * request details for on-chain completion.
 *
 * @openapi
 * /api/admin/moderation-escrow/create-payment:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Create escrow payment
 *     description: Creates escrow payment request via X402 (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipientId
 *               - amount
 *             properties:
 *               recipientId:
 *                 type: string
 *               amount:
 *                 type: string
 *                 description: Amount in ETH (as string)
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 escrowId:
 *                   type: string
 *                 paymentRequest:
 *                   type: object
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * await fetch('/api/admin/moderation-escrow/create-payment', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` },
 *   body: JSON.stringify({
 *     recipientId: 'user-id',
 *     amount: '0.1',
 *     reason: 'Moderation reward'
 *   })
 * });
 * ```
 */

import { createEscrowPayment, escrowErrorHttpStatus } from '@feed/a2a';
import { requirePermission, withErrorHandling } from '@feed/api';
import { logger, toISO } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const CreateEscrowPaymentSchema = z.object({
  recipientId: z.string().min(1, 'Recipient ID is required'),
  amountUSD: z.number().positive('Amount must be positive'),
  reason: z.string().optional(),
  recipientWalletAddress: z
    .string()
    .min(1, 'Recipient wallet address is required'),
});

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const _adminUser = await requirePermission(req, 'manage_escrow');
  const adminId = _adminUser.userId;

  const body = await req.json();
  const validation = CreateEscrowPaymentSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      {
        error: validation.error.issues[0]?.message || 'Invalid request data',
      },
      { status: 400 }
    );
  }

  const { recipientId, amountUSD } = validation.data;
  const result = await createEscrowPayment({
    adminId,
    ...validation.data,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: escrowErrorHttpStatus(result.code) }
    );
  }
  const { escrow, paymentRequest } = result.value;

  logger.info(
    `Admin ${adminId} created escrow payment for user ${recipientId}`,
    {
      adminId,
      recipientId,
      amountUSD,
      escrowId: escrow.id,
      paymentRequestId: paymentRequest.requestId,
    },
    'ModerationEscrow'
  );

  return NextResponse.json({
    success: true,
    escrow: {
      id: escrow.id,
      recipientId: escrow.recipientId,
      amountUSD: escrow.amountUSD,
      status: escrow.status,
      reason: escrow.reason,
      paymentRequestId: escrow.paymentRequestId,
      expiresAt: toISO(escrow.expiresAt),
    },
    paymentRequest,
  });
});
