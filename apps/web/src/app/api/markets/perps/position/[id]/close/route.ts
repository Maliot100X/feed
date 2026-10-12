import {
  authenticate,
  BadRequestError,
  checkRateLimitAsync,
  invalidateMarketsApiPerpsSnapshot,
  RATE_LIMIT_CONFIGS,
  rateLimitError,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { handlePlayerTrade } from '@feed/engine';
import {
  ClosePerpPositionSchema,
  fireAndForgetWithRetry,
  logger,
} from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { trackServerEvent } from '@/lib/posthog/server';
import { createPerpMarketService } from '../../../_adapters';

const IdParamSchema = z.object({
  id: z.string().trim().min(1).max(100),
});

type CloseOptions = { percentage?: number; slippage?: number };

/**
 * Parse the optional close body. An absent/empty body (or `{}`) means a full
 * market close with no slippage bound, matching existing clients. A body that
 * is present but not valid JSON, or fails the schema, is rejected before any
 * mutation. Limit closes are not supported by the service, so they are
 * rejected rather than silently executed at market.
 */
async function parseCloseBody(request: NextRequest): Promise<CloseOptions> {
  const raw = await request.text();
  if (raw.trim() === '') return {};

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new BadRequestError('Request body must be valid JSON');
  }

  if (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0
  ) {
    return {};
  }

  const parsed = ClosePerpPositionSchema.parse(body);
  if (parsed.orderType !== 'market') {
    throw new BadRequestError(
      'Only market close orders are supported',
      'UNSUPPORTED_ORDER_TYPE'
    );
  }
  return { percentage: parsed.percentage, slippage: parsed.slippage };
}

/**
 * POST /api/markets/perps/position/[id]/close
 * Close an existing perpetual futures position (full or partial).
 *
 * Supports partial close via `percentage` body param (0-1, e.g., 0.5 = 50%).
 * Uses PerpMarketService with SSE broadcast enabled for real-time UI updates.
 */
export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const user = await authenticate(request);

    // Rate limit: 10 closes per minute per user
    const rateLimitResult = await checkRateLimitAsync(
      user.userId,
      RATE_LIMIT_CONFIGS.CLOSE_POSITION
    );
    if (!rateLimitResult.allowed)
      return rateLimitError(rateLimitResult.retryAfter);

    const { id: positionId } = IdParamSchema.parse(await context.params);

    // Parse and validate request body (optional for partial close)
    const parsed = await parseCloseBody(request);

    // Create service with fee processor, broadcast, and price impact protection
    // Price impact adjustment (BF-75) is handled inside the service via PriceImpactPort,
    // using average fill pricing for fair close execution.
    const service = createPerpMarketService({
      withFeeProcessor: true,
      withBroadcast: true,
      withPriceImpact: true,
    });

    const result = await service.closePosition({
      userId: user.userId,
      positionId,
      percentage: parsed.percentage,
      maxSlippage: parsed.slippage,
    });

    // Track analytics event (fire and forget)
    trackServerEvent(user.userId, 'trade_closed', {
      type: 'perp',
      ticker: result.ticker,
      side: result.side,
      size: result.size,
      leverage: result.leverage,
      entryPrice: result.entryPrice ?? 0,
      exitPrice: result.exitPrice ?? 0,
      realizedPnL: result.realizedPnL ?? 0,
      pnlPercent:
        result.marginPaid && result.marginPaid > 0
          ? ((result.realizedPnL ?? 0) / result.marginPaid) * 100
          : 0,
      feeCharged: result.feePaid,
      wasLiquidated: false,
      positionId,
    }).catch((error) => {
      logger.warn(
        'Failed to track trade_closed event',
        { error: error instanceof Error ? error.message : String(error) },
        'PerpClose'
      );
    });

    // Handle player influence - closing positions also affects NPC memory
    // The opposite side represents the closing action
    const closingSide = result.side === 'long' ? 'short' : 'long';
    fireAndForgetWithRetry(
      () =>
        handlePlayerTrade(user.userId, result.ticker, closingSide, result.size),
      {
        logContext: 'PerpClose',
        metadata: {
          userId: user.userId,
          ticker: result.ticker,
          side: closingSide,
          size: result.size,
        },
      }
    );

    void invalidateMarketsApiPerpsSnapshot();

    return successResponse({
      position: result,
      grossSettlement:
        result.realizedPnL !== undefined && result.marginPaid !== undefined
          ? result.marginPaid + result.realizedPnL
          : undefined,
      netSettlement:
        result.realizedPnL !== undefined && result.marginPaid !== undefined
          ? Math.max(0, result.marginPaid + result.realizedPnL - result.feePaid)
          : undefined,
      marginReturned: result.marginPaid,
      pnl: result.realizedPnL,
      fee: {
        amount: result.feePaid,
        referrerPaid: 0,
      },
      wasLiquidated: false,
      newBalance: result.balance,
    });
  }
);
