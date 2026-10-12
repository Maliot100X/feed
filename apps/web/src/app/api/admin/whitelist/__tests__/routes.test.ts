import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

let selectResults: object[][] = [];
const addToWhitelist = mock(async () => ({ id: 'w1', alreadyExists: false }));
const listWhitelistEntries = mock(async () => []);
const updateWhitelistConfig = mock(async () => undefined);

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    select: () => {
      const c = {
        from: () => c,
        where: () => c,
        limit: async () => selectResults.shift() ?? [],
      };
      return c;
    },
  },
}));

mock.module('@feed/api/services/whitelist-service', () => ({
  addToWhitelist,
  getWhitelistStats: async () => ({}),
  listWhitelistEntries,
  removeFromWhitelist: async () => ({ removed: true }),
  getWhitelistConfig: async () => null,
  updateWhitelistConfig,
}));

mock.module('@feed/api', () => ({
  requireAdmin: async () => ({ userId: 'admin-1', dbUserId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const route = await import('../route');
const config = await import('../config/route');

function req(method: string, body?: object, query = '') {
  return new Request(`http://localhost/api/admin/whitelist${query}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  }) as never;
}

describe('admin whitelist routes', () => {
  beforeEach(() => {
    selectResults = [];
    addToWhitelist.mockClear();
    listWhitelistEntries.mockClear();
    updateWhitelistConfig.mockClear();
  });

  it('rejects spoofed provenance sources', async () => {
    const res = (await route.POST(
      req('POST', { userId: 'u1', source: 'leaderboard' })
    )) as Response;
    expect(res.status).toBe(400);
    expect(addToWhitelist).not.toHaveBeenCalled();
  });

  it('prefers an exact id match and records admin_manual', async () => {
    selectResults = [[{ id: 'u1', username: 'alice' }]];
    const res = (await route.POST(req('POST', { userId: ' u1 ' }))) as Response;
    expect(res.status).toBe(200);
    expect(addToWhitelist).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', source: 'admin_manual' })
    );
  });

  it('rejects ambiguous case-insensitive username matches', async () => {
    selectResults = [
      [],
      [
        { id: 'u1', username: 'Alice' },
        { id: 'u2', username: 'alice' },
      ],
    ];
    const res = (await route.POST(
      req('POST', { userId: '@alice' })
    )) as Response;
    expect(res.status).toBe(409);
    expect(addToWhitelist).not.toHaveBeenCalled();
  });

  it('validates the list source filter', async () => {
    const res = (await route.GET(
      req('GET', undefined, '?source=bogus')
    )) as Response;
    expect(res.status).toBe(400);
    expect(listWhitelistEntries).not.toHaveBeenCalled();
  });

  it('config PUT rejects unsafe thresholds and unknown categories', async () => {
    for (const body of [
      { leaderboardRankThreshold: 1e20 },
      { leaderboardRankThreshold: 10, leaderboardCategory: 'bogus' },
      { leaderboardRankThreshold: null },
    ]) {
      const res = (await config.PUT(req('PUT', body))) as Response;
      expect(res.status).toBe(400);
    }
    expect(updateWhitelistConfig).not.toHaveBeenCalled();
  });
});
