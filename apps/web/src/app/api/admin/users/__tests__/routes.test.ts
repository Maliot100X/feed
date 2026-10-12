import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualApi from '@feed/api';
import * as actualDb from '@feed/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextResponse } from 'next/server';

const dialect = new PgDialect();
const calls: string[] = [];
let orderByArgs: actualDb.SQL[] = [];
let banReturning: object[] = [];
let banWhere: actualDb.SQL | undefined;
const distribute = mock(async () => undefined);
let targetIsRoleAdmin = false;

function listChain() {
  const c = {
    from: () => c,
    where: () => c,
    groupBy: () => c,
    orderBy: (...args: actualDb.SQL[]) => {
      orderByArgs = args;
      calls.push('orderBy');
      return c;
    },
    limit: () => {
      calls.push('limit');
      return c;
    },
    offset: async () => [],
    then: (resolve: (rows: object[]) => void) => resolve([{ count: 0 }]),
  };
  return c;
}

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    select: listChain,
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        username: where.id,
        displayName: where.id,
        isActor: false,
        isAdmin: false,
        isBanned: false,
      }),
    },
    update: () => ({
      set: () => ({
        where: (w: actualDb.SQL) => {
          banWhere = w;
          return { returning: async () => banReturning };
        },
      }),
    }),
  },
}));

mock.module('@feed/api', () => ({
  BusinessLogicError: actualApi.BusinessLogicError,
  NotFoundError: actualApi.NotFoundError,
  distributeReputationToReporters: distribute,
  getClientIp: () => null,
  isUserAdmin: async () => targetIsRoleAdmin,
  logAdminAction: async () => undefined,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: actualApi.withErrorHandling,
}));

const list = (await import('../route')).GET;
const ban = (await import('../[userId]/ban/route')).POST;

function callBan(userId: string, body: object) {
  return ban(
    new Request(`http://localhost/api/admin/users/${userId}/ban`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ userId }) }
  ) as Promise<Response>;
}

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    calls.length = 0;
    orderByArgs = [];
  });

  it('orders by moderation metrics in SQL before LIMIT/OFFSET', async () => {
    const res = (await list(
      new Request(
        'http://localhost/api/admin/users?sortBy=reports_received'
      ) as never
    )) as Response;
    expect(res.status).toBe(200);
    expect(calls.indexOf('orderBy')).toBeLessThan(calls.indexOf('limit'));
    const rendered = orderByArgs.map((o) => dialect.sqlToQuery(o).sql);
    expect(rendered[0]).toContain('"Report"."reportedUserId"');
    expect(rendered[0]).toContain('desc');
    expect(rendered[1]).toContain('"User"."id"');
  });

  it('rejects fractional pagination', async () => {
    const res = (await list(
      new Request('http://localhost/api/admin/users?limit=2.5') as never
    )) as Response;
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/users/[userId]/ban', () => {
  beforeEach(() => {
    banReturning = [];
    banWhere = undefined;
    distribute.mockClear();
    targetIsRoleAdmin = false;
  });

  it('refuses self-ban', async () => {
    const res = await callBan('admin-1', { action: 'ban', reason: 'x' });
    expect(res.status).toBe(400);
    expect(banWhere).toBeUndefined();
  });

  it('refuses to ban role-table admins', async () => {
    targetIsRoleAdmin = true;
    const res = await callBan('u2', { action: 'ban', reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('requires a reason to ban', async () => {
    const res = await callBan('u2', { action: 'ban' });
    expect(res.status).toBe(400);
  });

  it('does not repeat reporter rewards when already banned', async () => {
    const res = await callBan('u2', {
      action: 'ban',
      reason: 'scam',
      isScammer: true,
    });
    expect(res.status).toBe(400);
    expect(distribute).not.toHaveBeenCalled();
    expect(dialect.sqlToQuery(banWhere as actualDb.SQL).sql).toContain(
      '"isBanned"'
    );
  });

  it('bans once and distributes rewards', async () => {
    banReturning = [
      {
        id: 'u2',
        isBanned: true,
        bannedReason: 'scam',
        isScammer: true,
        isCSAM: false,
      },
    ];
    const res = await callBan('u2', {
      action: 'ban',
      reason: 'scam',
      isScammer: true,
    });
    expect(res.status).toBe(200);
    expect(distribute).toHaveBeenCalledTimes(1);
  });
});
