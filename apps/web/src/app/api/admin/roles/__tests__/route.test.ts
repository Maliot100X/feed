import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

type Row = Record<string, string | null>;

const selectResults: Row[][] = [];
const inserted: Row[] = [];
const updates: Row[] = [];

function selectChain() {
  const result = () => Promise.resolve(selectResults.shift() ?? []);
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: () => result(),
    then: (resolve: (rows: Row[]) => void) => result().then(resolve),
  };
  return chain;
}

const tx = {
  select: () => selectChain(),
  insert: () => ({
    values: (row: Row) => {
      inserted.push(row);
      return { onConflictDoUpdate: () => Promise.resolve() };
    },
  }),
  update: () => ({
    set: (values: Row) => ({
      where: () => {
        updates.push(values);
        return Promise.resolve();
      },
    }),
  }),
};

const mockDb = {
  select: () => selectChain(),
  transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
};

mock.module('@feed/db', () => ({
  ...actualDb,
  db: mockDb,
  generateSnowflakeId: async () => '1234567890',
}));

mock.module('@feed/api', () => ({
  applyRateLimit: () => ({ allowed: true }),
  RATE_LIMIT_CONFIGS: { ADMIN_ACTION: {} },
  rateLimitError: () => NextResponse.json({}, { status: 429 }),
  requireAdmin: async () => ({ userId: 'super-1' }),
  requireSuperAdmin: async () => ({ userId: 'super-1' }),
  getAllAdmins: async () => [],
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  successResponse: (data: object, status = 200) =>
    NextResponse.json(data, { status }),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { POST } = await import('../route');

function post(body: object) {
  return POST(
    new Request('http://localhost/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

const target = { id: 'user-2', username: 'u2', displayName: 'User 2' };

describe('POST /api/admin/roles', () => {
  beforeEach(() => {
    selectResults.length = 0;
    inserted.length = 0;
    updates.length = 0;
  });

  it('grants with an awaited snowflake id (not a Promise string)', async () => {
    selectResults.push([target], [{ userId: 'super-1' }]);
    const res = await post({
      userId: 'user-2',
      action: 'grant',
      role: 'ADMIN',
    });
    expect(res.status).toBe(200);
    expect(inserted[0]?.id).toBe('admin_role_1234567890');
    expect(String(inserted[0]?.id)).not.toContain('Promise');
  });

  it('refuses to downgrade the last super admin', async () => {
    selectResults.push([target], [{ userId: 'user-2' }]);
    const res = await post({
      userId: 'user-2',
      action: 'grant',
      role: 'ADMIN',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('LAST_SUPER_ADMIN');
    expect(inserted).toHaveLength(0);
  });

  it('refuses to revoke the last super admin using row locks', async () => {
    selectResults.push(
      [target],
      [{ role: 'SUPER_ADMIN' }],
      [{ userId: 'user-2' }]
    );
    const res = await post({ userId: 'user-2', action: 'revoke' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('LAST_SUPER_ADMIN');
    expect(updates).toHaveLength(0);
  });

  it('revokes a super admin when another remains', async () => {
    selectResults.push(
      [target],
      [{ role: 'SUPER_ADMIN' }],
      [{ userId: 'user-2' }, { userId: 'super-1' }]
    );
    const res = await post({ userId: 'user-2', action: 'revoke' });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(2);
  });

  it('returns NO_ACTIVE_ROLE when target has no active role', async () => {
    selectResults.push([target], []);
    const res = await post({ userId: 'user-2', action: 'revoke' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('NO_ACTIVE_ROLE');
  });
});
