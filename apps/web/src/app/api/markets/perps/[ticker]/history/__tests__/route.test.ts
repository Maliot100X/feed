import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

const limitCalls: number[] = [];
let selectCount = 0;

function chain(rows: unknown[]) {
  const query = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: (value: number) => {
      limitCalls.push(value);
      return Promise.resolve(rows);
    },
  };
  return query;
}

mock.module('@feed/api', () => ({
  addPublicReadHeaders: () => undefined,
  publicRateLimit: async () => ({ error: null, rateLimitInfo: null }),
  successResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/db', () => ({
  and: () => undefined,
  desc: () => undefined,
  eq: () => undefined,
  gte: () => undefined,
  perpMarketSnapshots: {},
  stockPrices: {},
  db: {
    select: () => {
      selectCount += 1;
      return chain(selectCount === 1 ? [{ organizationId: 'org-1' }] : []);
    },
  },
}));

mock.module('@feed/shared', () => ({
  toISO: (value: Date) => value.toISOString(),
}));

const { GET } = await import('../route');

const context = { params: Promise.resolve({ ticker: 'ABC' }) };

function historyRequest(query: string): NextRequest {
  return new Request(
    `http://localhost/api/markets/perps/ABC/history${query}`
  ) as unknown as NextRequest;
}

describe('GET /api/markets/perps/[ticker]/history query parsing', () => {
  beforeEach(() => {
    limitCalls.length = 0;
    selectCount = 0;
  });

  it('accepts omitted limit and range', async () => {
    const response = (await GET(historyRequest(''), context)) as Response;
    const body = (await response.json()) as { organizationId: string };

    expect(response.status).toBe(200);
    expect(body.organizationId).toBe('org-1');
    // snapshot lookup (1) then raw history with the default limit
    expect(limitCalls).toEqual([1, 200]);
  });

  it('accepts a limit without a range', async () => {
    await GET(historyRequest('?limit=50'), context);

    expect(limitCalls).toEqual([1, 50]);
  });
});
