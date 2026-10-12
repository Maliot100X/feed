import { describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

const now = Date.now();

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    game: {
      findFirst: async () => ({
        id: 'g1',
        isRunning: true,
        currentDay: 3,
        currentDate: new Date(now),
        // Started 10 minutes ago: hourly/daily averages must still use the
        // full fixed window, not be zeroed or divided by uptime.
        startedAt: new Date(now - 10 * 60_000),
        pausedAt: null,
        lastTickAt: new Date(now - 5_000),
        speed: 60_000,
      }),
    },
    post: { count: async () => 60 },
    chat: { count: async () => 2 },
    // All messages including DMs
    message: { count: async () => 1000 },
    llmCallLog: {
      count: async () => 0,
      aggregate: async () => ({
        _sum: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        _avg: { latencyMs: 0 },
      }),
    },
    select: () => {
      const c = {
        from: () => c,
        innerJoin: () => c,
        where: () => Promise.resolve([{ count: 40 }]),
      };
      return c;
    },
  },
}));

mock.module('@feed/api', () => ({
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { GET } = await import('../route');

describe('GET /api/admin/game-stats', () => {
  it('reports honest rates, group-only message averages and zero latency', async () => {
    const res = (await GET(
      new Request('http://localhost/api/admin/game-stats') as never
    )) as Response;
    const body = await res.json();
    expect(body.gameState.estimatedTotalTicks).toBeUndefined();
    expect(body.rates.postsPerMinuteAvgHour).toBe(1);
    expect(body.rates.postsPerMinuteAvgDay).toBe(
      Math.round((60 / 1440) * 100) / 100
    );
    // 40 group messages / 2 group chats (not 1000 total messages / 2)
    expect(body.totals.avgMessagesPerChat).toBe(20);
    expect(body.llmStats.avgLatencyMs24h).toBe(0);
  });
});
