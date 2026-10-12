import { describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';
import { PredictionMarketIdSchema } from '../../../../../../../../../packages/shared/src/validation/schemas/common';
import { MarketQuerySchema } from '../../../../../../../../../packages/shared/src/validation/schemas/market';

const MARKET_ID = '123456789012345678';

function countQuery() {
  const query = {
    from: () => query,
    where: () => Promise.resolve([{ count: 0 }]),
  };
  return query;
}

mock.module('@feed/api', () => ({
  addPublicReadHeaders: () => undefined,
  publicRateLimit: async () => ({
    error: null,
    user: null,
    rateLimitInfo: null,
  }),
  successResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/core/markets/prediction', () => ({
  PredictionDbAdapter: class {},
  PredictionMarketService: class {
    getMarket = async () => ({
      id: MARKET_ID,
      question: 'Cancelled?',
      yesShares: 100,
      noShares: 100,
      liquidity: 200,
      endDate: new Date('2030-01-01T00:00:00Z'),
      resolved: false,
      status: 'cancelled',
    });
    ensureMarketExists = async () => null;
    listUserPositions = async () => [];
  },
  PredictionPricing: { getCurrentPrice: () => 0.5 },
  calculatePredictionPositionSnapshot: () => ({}),
}));

mock.module('@feed/db', () => ({
  and: () => undefined,
  balanceTransactions: {},
  count: () => undefined,
  db: { select: () => countQuery() },
  eq: () => undefined,
  inArray: () => undefined,
  npcTrades: {},
}));

mock.module('@feed/engine', () => ({
  FEE_CONFIG: {
    TRADING_FEE_RATE: 0.01,
    PLATFORM_SHARE: 0.5,
    REFERRER_SHARE: 0.5,
    MIN_FEE_AMOUNT: 0,
  },
  WalletService: {},
}));

mock.module('@feed/shared', () => ({
  logger: { info: mock(), warn: mock(), error: mock() },
  MarketQuerySchema,
  PredictionMarketIdSchema,
  toISOOrNull: (value: Date | null | undefined) =>
    value ? new Date(value).toISOString() : null,
}));

mock.module('../../_resolution-audit', () => ({
  getPublicResolutionAudit: async () => null,
}));

const { GET } = await import('../route');

describe('GET /api/markets/predictions/[id]', () => {
  it('reports the stored status for cancelled, unresolved markets', async () => {
    const response = (await GET(
      new Request(
        `http://localhost/api/markets/predictions/${MARKET_ID}`
      ) as unknown as NextRequest,
      { params: Promise.resolve({ id: MARKET_ID }) }
    )) as Response;
    const body = (await response.json()) as { market: { status: string } };

    expect(response.status).toBe(200);
    expect(body.market.status).toBe('cancelled');
  });
});
