/**
 * Points Purchase Create Payment API
 *
 * @route POST /api/points/purchase/create-payment - Create payment request
 * @access Authenticated
 *
 * @description
 * Creates an x402 payment request for funding trading balance. Returns payment
 * request details for on-chain completion. Uses X402 escrow system.
 *
 * @openapi
 * /api/points/purchase/create-payment:
 *   post:
 *     tags:
 *       - Points
 *     summary: Create payment request for trading balance funding
 *     description: Creates x402 payment request for trading balance funding
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountUSD
 *               - fromAddress
 *             properties:
 *               amountUSD:
 *                 type: number
 *                 description: Amount in USD
 *               fromAddress:
 *                 type: string
 *                 pattern: '^0x[a-fA-F0-9]{40}$'
 *                 description: User's wallet address
 *     responses:
 *       200:
 *         description: Payment request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                 paymentRequest:
 *                   type: object
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *
 * @example
 * ```typescript
 * await fetch('/api/points/purchase/create-payment', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${token}` },
 *   body: JSON.stringify({
 *     amountUSD: 10,
 *     fromAddress: '0x...'
 *   })
 * });
 * ```
 */

import { getSharedX402Manager } from '@feed/a2a';
import { authenticate, withErrorHandling } from '@feed/api';
import { db, eq, users } from '@feed/db';
import { logger } from '@feed/shared';
import { getAddress, isAddress, parseEther } from 'ethers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { trackServerEvent } from '@/lib/posthog/server';

const CreatePaymentBodySchema = z.object({
  amountUSD: z
    .number()
    .finite()
    .positive()
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: 'amountUSD must have at most 2 decimal places',
    }),
  fromAddress: z.string().refine(isAddress, 'Invalid wallet address'),
});

/** Payment receiver; requests are refused when it is not configured. */
function getPaymentReceiver(): string | null {
  const receiver =
    process.env.POINTS_PAYMENT_RECEIVER ||
    process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
  if (!receiver || !isAddress(receiver) || BigInt(receiver) === 0n) {
    return null;
  }
  return getAddress(receiver);
}

export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const authUser = await authenticate(req);
  const userId = authUser.dbUserId!;

  const parsed = CreatePaymentBodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid request',
      },
      { status: 400 }
    );
  }
  const { amountUSD, fromAddress } = parsed.data;

  const paymentReceiver = getPaymentReceiver();
  if (!paymentReceiver) {
    logger.error(
      'Points payment receiver is not configured',
      undefined,
      'TradingBalanceFunding'
    );
    return NextResponse.json(
      { success: false, error: 'Crypto purchases are not available' },
      { status: 503 }
    );
  }

  // The paying wallet must be the user's linked wallet: verification binds
  // the on-chain sender to this address.
  const [user] = await db
    .select({ walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (
    !user?.walletAddress ||
    user.walletAddress.toLowerCase() !== fromAddress.toLowerCase()
  ) {
    return NextResponse.json(
      {
        success: false,
        error: 'fromAddress must be the wallet linked to your account',
      },
      { status: 400 }
    );
  }

  const balanceUnits = Math.round(amountUSD * 100);

  // Existing conversion policy: 1 USD = 0.001 ETH.
  const amountInWei = parseEther((amountUSD * 0.001).toFixed(18)).toString();

  const x402Manager = await getSharedX402Manager();
  const paymentRequest = await x402Manager.createPaymentRequest(
    getAddress(fromAddress),
    paymentReceiver,
    amountInWei,
    'trading_balance_purchase',
    {
      userId,
      amountUSD,
      balanceUnits,
    }
  );

  logger.info(
    `Created payment request for ${balanceUnits} balance units ($${amountUSD})`,
    {
      userId,
      requestId: paymentRequest.requestId,
      amountUSD,
      balanceUnits,
    },
    'TradingBalanceFunding'
  );

  void trackServerEvent(userId, 'trading_balance_purchase_initiated', {
    amountUSD,
    balanceUnits,
    requestId: paymentRequest.requestId,
  }).catch((err) => {
    logger.warn(
      'Failed to track trading_balance_purchase_initiated',
      { error: err },
      'TradingBalanceFunding'
    );
  });

  return NextResponse.json({
    success: true,
    paymentRequest: {
      requestId: paymentRequest.requestId,
      amount: paymentRequest.amount,
      from: paymentRequest.from,
      to: paymentRequest.to,
      expiresAt: paymentRequest.expiresAt,
      balanceUnits,
      amountUSD,
    },
  });
});
