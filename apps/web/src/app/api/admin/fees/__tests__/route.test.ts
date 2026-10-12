import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualApi from '@feed/api';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

const fromCalls: object[] = [];
let trendRows: object[] = [];

function chain() {
  let source: object = {};
  let grouped = false;
  const rows = () => {
    if (source === actualDb.pools) return [{ _sum: '1000' }];
    if (source === actualDb.tradingFees && grouped) return trendRows;
    return [];
  };
  const c = {
    from: (s: object) => {
      source = s;
      fromCalls.push(s);
      return c;
    },
    leftJoin: () => c,
    innerJoin: () => c,
    where: () => c,
    groupBy: () => {
      grouped = true;
      return c;
    },
    orderBy: () => c,
    limit: () => c,
    then: (resolve: (r: object[]) => void) => resolve(rows()),
  };
  return c;
}

mock.module('@feed/db', () => ({
  ...actualDb,
  db: { select: chain, user: { findUnique: async () => null } },
}));

mock.module('@feed/engine', () => ({
  FeeService: {
    getPlatformFeeStats: async () => ({
      totalFeesCollected: 50,
      totalPlatformFees: 40,
      totalReferrerFees: 10,
      totalTrades: 5,
    }),
  },
  StaticDataRegistry: { getActor: () => null },
}));

mock.module('@feed/api', () => ({
  ...actualApi,
  applyRateLimit: () => ({ allowed: true }),
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { GET } = await import('../route');

async function get(query = '') {
  const res = (await GET(
    new Request(`http://localhost/api/admin/fees${query}`) as never
  )) as Response;
  return { status: res.status, body: await res.json() };
}

describe('GET /api/admin/fees', () => {
  beforeEach(() => {
    fromCalls.length = 0;
    trendRows = [];
  });

  it('includes lifetime NPC fees only without a date range', async () => {
    const { body } = await get();
    expect(body.platformStats.totalFeesCollected).toBe(1050);
    expect(body.platformStats.npcFeesScope).toBe('lifetime');
  });

  it('excludes lifetime NPC fees from date-filtered totals', async () => {
    const { body } = await get(
      '?startDate=2026-09-01T00:00:00Z&endDate=2026-09-10T00:00:00Z'
    );
    expect(body.platformStats.totalFeesCollected).toBe(50);
    expect(body.platformStats.totalNPCFees).toBe(0);
    expect(body.platformStats.npcFeesScope).toBe('excluded');
    expect(fromCalls).not.toContain(actualDb.pools);
  });

  it('returns SQL-aggregated trend rows', async () => {
    trendRows = [{ date: '2026-09-01', totalFees: '12.30', tradeCount: 3 }];
    const { body } = await get('?endDate=2026-09-10T00:00:00Z');
    expect(body.feeTrend).toEqual([
      { date: '2026-09-01', totalFees: 12.3, tradeCount: 3 },
    ]);
  });

  it('rejects junk limits', async () => {
    expect((await get('?limit=12junk')).status).toBe(400);
  });
});
