import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';

let listSelectCalls = 0;

const listChain = {
  from: () => listChain,
  leftJoin: () => listChain,
  where: () => listChain,
  orderBy: () => listChain,
  limit: () => listChain,
  offset: async () => [],
  then: (resolve: (rows: { count: number }[]) => void) =>
    resolve([{ count: 0 }]),
};

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => {
      listSelectCalls++;
      return listChain;
    },
  },
}));

const requirePermission = mock(async () => ({ userId: 'admin-1' }));

mock.module('@feed/api', () => ({
  requirePermission,
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const list = (await import('../list/route')).GET;

function req(path: string) {
  return new Request(
    `http://localhost/api/admin/moderation-escrow/${path}`
  ) as never;
}

beforeEach(() => {
  listSelectCalls = 0;
});

describe('list', () => {
  it('accepts a bare GET with no query parameters', async () => {
    const res = (await list(req('list'))) as Response;
    expect(res.status).toBe(200);
    expect(listSelectCalls).toBe(2);
  });

  it('requires the manage_escrow permission', async () => {
    requirePermission.mockClear();
    await list(req('list'));
    expect(requirePermission.mock.calls.map((c) => c[1])).toEqual([
      'manage_escrow',
    ]);
  });

  it('rejects fractional limits', async () => {
    const res = (await list(req('list?limit=1.5'))) as Response;
    expect(res.status).toBe(400);
  });
});
