import { describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

const mockGetCache = mock();
const mockAddHeaders = mock();

mock.module('@feed/api', () => ({
  addPublicReadHeaders: mockAddHeaders,
  getCache: mockGetCache,
  publicRateLimit: async () => ({
    error: null,
    rateLimitInfo: { limit: 60, remaining: 59 },
  }),
  setCache: async () => undefined,
  successResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/db', () => ({ db: {} }));

mock.module('@feed/engine', () => ({
  StaticDataRegistry: { getAllOrganizations: () => [] },
}));

mock.module('@feed/shared', () => ({
  logger: { info: mock(), debug: mock(), warn: mock(), error: mock() },
}));

const { GET } = await import('../route');

describe('GET /api/markets/perps/trades/[ticker] cache', () => {
  it('reads from the same namespace it writes and keeps rate-limit headers on hits', async () => {
    mockGetCache.mockResolvedValue({ trades: [], total: 0, hasMore: false });

    const response = (await GET(
      new Request(
        'http://localhost/api/markets/perps/trades/ABC'
      ) as unknown as NextRequest,
      { params: Promise.resolve({ ticker: 'ABC' }) }
    )) as Response;

    expect(response.status).toBe(200);
    expect(mockGetCache).toHaveBeenCalledWith('perp-trades:abc:50:0', {
      namespace: 'market-trades',
    });
    expect(mockAddHeaders).toHaveBeenCalledTimes(1);
  });
});
