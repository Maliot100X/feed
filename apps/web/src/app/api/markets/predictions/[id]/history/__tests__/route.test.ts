import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';
import { PredictionMarketIdSchema } from '../../../../../../../../../../packages/shared/src/validation/schemas/common';

const limitCalls: number[] = [];

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
  predictionPriceHistories: {},
  db: { select: () => chain([]) },
}));

mock.module('@feed/shared', () => ({
  PredictionMarketIdSchema,
  toISO: (value: Date) => value.toISOString(),
}));

const { GET } = await import('../route');

const context = { params: Promise.resolve({ id: '123456789012345678' }) };

function historyRequest(query: string): NextRequest {
  return new Request(
    `http://localhost/api/markets/predictions/123456789012345678/history${query}`
  ) as unknown as NextRequest;
}

describe('GET /api/markets/predictions/[id]/history query parsing', () => {
  beforeEach(() => {
    limitCalls.length = 0;
  });

  it('accepts omitted limit and range (uses default limit, raw series)', async () => {
    const response = (await GET(historyRequest(''), context)) as Response;

    expect(response.status).toBe(200);
    expect(limitCalls).toEqual([200]);
  });

  it('accepts an explicit range with omitted limit', async () => {
    const response = (await GET(
      historyRequest('?range=1D'),
      context
    )) as Response;

    expect(response.status).toBe(200);
    expect(limitCalls).toEqual([5000]);
  });

  it('rejects fractional limits', async () => {
    await expect(GET(historyRequest('?limit=1.5'), context)).rejects.toThrow();
  });
});
