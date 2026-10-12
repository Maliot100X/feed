import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualApi from '@feed/api';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

type Target = {
  id: string;
  username: string;
  displayName: string;
  isActor: boolean;
  isAdmin: boolean;
  isBanned: boolean;
};

let target: Target | null = null;
let activeRole: { role: string }[] = [];
const userUpdates: object[] = [];
const requireSuperAdmin = mock(async () => ({ userId: 'super-1' }));
const requireAdmin = mock(async () => ({ userId: 'admin-1' }));

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    user: {
      findUnique: async () => target,
      update: async (args: { data: object }) => {
        userUpdates.push(args.data);
        return { username: target?.username };
      },
    },
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => activeRole }),
      }),
    }),
  },
}));

mock.module('@feed/api', () => ({
  BusinessLogicError: actualApi.BusinessLogicError,
  NotFoundError: actualApi.NotFoundError,
  getClientIp: () => null,
  logAdminAction: async () => undefined,
  requireAdmin,
  requireSuperAdmin,
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: () => Promise<Response>) => handler,
}));

const { POST } = await import('../route');

function call(action: string) {
  return POST(
    new Request('http://localhost/api/admin/admins/user-2', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }) as never,
    { params: Promise.resolve({ userId: 'user-2' }) }
  ) as Promise<Response>;
}

const base: Target = {
  id: 'user-2',
  username: 'u2',
  displayName: 'U2',
  isActor: false,
  isAdmin: false,
  isBanned: false,
};

describe('POST /api/admin/admins/[userId]', () => {
  beforeEach(() => {
    target = { ...base };
    activeRole = [];
    userUpdates.length = 0;
    requireSuperAdmin.mockClear();
    requireAdmin.mockClear();
  });

  it('requires super admin authority', async () => {
    const res = await call('promote');
    expect(res.status).toBe(200);
    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('propagates super admin rejection without mutating', async () => {
    requireSuperAdmin.mockImplementationOnce(async () => {
      throw new actualApi.AuthorizationError('no', 'admin', 'super_admin');
    });
    await expect(call('promote')).rejects.toThrow();
    expect(userUpdates).toHaveLength(0);
  });

  it('refuses to promote banned users but allows demoting them', async () => {
    target = { ...base, isBanned: true };
    await expect(call('promote')).rejects.toThrow('Cannot promote banned');

    target = { ...base, isBanned: true, isAdmin: true };
    const res = await call('demote');
    expect(res.status).toBe(200);
    expect(userUpdates).toEqual([expect.objectContaining({ isAdmin: false })]);
  });

  it('refuses legacy demote for users with an active AdminRole', async () => {
    target = { ...base, isAdmin: true };
    activeRole = [{ role: 'ADMIN' }];
    await expect(call('demote')).rejects.toThrow('revoke it via role');
    expect(userUpdates).toHaveLength(0);
  });
});
