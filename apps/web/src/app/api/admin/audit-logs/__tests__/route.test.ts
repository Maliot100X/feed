import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

type LogRow = {
  id: string;
  createdAt: Date;
  createdAtCursor: string;
  adminId: string;
};

let pageRows: LogRow[] = [];
const whereArgs: (actualDb.SQL | undefined)[] = [];

function chain(rows: object[]) {
  const c = {
    from: () => c,
    leftJoin: () => c,
    where: (w: actualDb.SQL | undefined) => {
      whereArgs.push(w);
      return c;
    },
    orderBy: () => c,
    limit: () => c,
    offset: async () => rows,
    then: (resolve: (r: object[]) => void) => resolve(rows),
  };
  return c;
}

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    select: (fields: Record<string, object>) =>
      'count' in fields ? chain([{ count: 3 }]) : chain(pageRows),
    selectDistinct: () => chain([]),
  },
}));

mock.module('@feed/api', () => ({
  requireAdmin: async () => ({ userId: 'admin-1' }),
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { GET } = await import('../route');

function get(query: string) {
  return GET(
    new Request(`http://localhost/api/admin/audit-logs?${query}`) as never
  ) as Promise<Response>;
}

const sameInstant = '2026-10-11 10:00:00.123456';

describe('GET /api/admin/audit-logs', () => {
  beforeEach(() => {
    whereArgs.length = 0;
    pageRows = [
      {
        id: 'b',
        createdAt: new Date(),
        createdAtCursor: sameInstant,
        adminId: 'a',
      },
      {
        id: 'a',
        createdAt: new Date(),
        createdAtCursor: sameInstant,
        adminId: 'a',
      },
    ];
  });

  it('emits a compound cursor that round-trips (createdAt, id)', async () => {
    const res = await get('limit=1');
    const body = await res.json();
    expect(body.pagination.hasMore).toBe(true);
    expect(body.logs[0].createdAtCursor).toBeUndefined();
    const decoded = JSON.parse(
      Buffer.from(body.pagination.nextCursor, 'base64url').toString('utf8')
    );
    expect(decoded).toEqual({ createdAt: sameInstant, id: 'b' });

    const next = await get(`limit=1&cursor=${body.pagination.nextCursor}`);
    expect(next.status).toBe(200);
    expect(whereArgs.at(-1)).toBeDefined();
  });

  it('rejects malformed cursors and cursor+offset combinations', async () => {
    expect((await get('cursor=not-a-cursor')).status).toBe(400);
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: sameInstant, id: 'b' })
    ).toString('base64url');
    expect((await get(`cursor=${cursor}&offset=10`)).status).toBe(400);
  });

  it('rejects fractional pagination values', async () => {
    expect((await get('limit=2.5')).status).toBe(400);
    expect((await get('offset=1.5')).status).toBe(400);
  });
});
