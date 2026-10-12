import { describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

let stats = {
  totalQueries: 0,
  slowQueries: 0,
  avgDuration: 0,
  p95Duration: 0,
  p99Duration: 0,
};

mock.module('@feed/db', () => ({
  ...actualDb,
  queryMonitor: {
    getQueryStats: () => stats,
    getSlowQueryStats: () => ({}),
    getRecentQueries: () => [],
  },
}));

mock.module('@feed/api', () => ({
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { GET } = await import('../route');

async function health() {
  const res = (await GET(
    new Request('http://localhost/api/admin/network-stats') as never
  )) as Response;
  return (await res.json()).health;
}

describe('GET /api/admin/network-stats', () => {
  it('reports unknown database health with no observed queries', async () => {
    stats = { ...stats, totalQueries: 0, slowQueries: 0 };
    expect((await health()).database).toBe('unknown');
  });

  it('uses the same thresholds for component and overall health', async () => {
    stats = { ...stats, totalQueries: 100, slowQueries: 10 };
    const h = await health();
    expect(h.database).toBe('warning');
    expect(['warning', 'critical']).toContain(h.overall);
  });
});
