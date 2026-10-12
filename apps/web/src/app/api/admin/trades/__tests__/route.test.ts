import { beforeEach, describe, expect, it, mock } from 'bun:test';

type Row = { id: string; userId?: string; npcActorId?: string } & Record<
  string,
  string | number | boolean | Date | null | undefined
>;

const mockRequireAdmin = mock(async () => ({ userId: 'admin-1' }));

function source(rows: Row[], timeField: string) {
  return {
    findMany: mock(async ({ take }: { take: number }) =>
      [...rows]
        .sort(
          (a, b) =>
            (b[timeField] as Date).getTime() - (a[timeField] as Date).getTime()
        )
        .slice(0, take)
    ),
    count: mock(async () => rows.length),
  };
}

const t = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

const balanceRows: Row[] = [1, 3, 5].map((m) => ({
  id: `b${m}`,
  userId: m === 5 ? 'deleted-user' : 'user-1',
  createdAt: t(m),
  amount: '10',
  balanceBefore: '0',
  balanceAfter: '10',
  type: 'deposit',
  description: null,
  relatedId: null,
}));
const npcRows: Row[] = [2, 4, 6].map((m) => ({
  id: `n${m}`,
  npcActorId: 'actor-1',
  executedAt: t(m),
  marketType: 'perp',
  ticker: 'ABC',
  marketId: null,
  action: 'open',
  side: 'long',
  amount: 5,
  price: 1,
  sentiment: null,
  reason: null,
}));

const db = {
  balanceTransaction: source(balanceRows, 'createdAt'),
  npcTrade: source(npcRows, 'executedAt'),
  position: source([], 'updatedAt'),
  user: {
    findMany: mock(async () => [
      {
        id: 'user-1',
        username: 'u1',
        displayName: 'User One',
        profileImageUrl: null,
        isActor: false,
      },
    ]),
  },
  market: { findMany: mock(async () => []) },
};

mock.module('@feed/api', () => ({
  requireAdmin: mockRequireAdmin,
  successResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));
mock.module('@feed/db', () => ({ db }));
mock.module('@feed/engine', () => ({
  StaticDataRegistry: {
    getActor: (id: string) =>
      id === 'actor-1'
        ? { id, name: 'Actor One', profileImageUrl: undefined }
        : null,
  },
}));

const { GET } = await import('../route');

type TradeBody = {
  trades: Array<{ type: string; id: string; user: { id: string } | null }>;
  pagination: { total: number; hasMore: boolean };
};

async function call(query: string): Promise<TradeBody> {
  const request = { url: `http://localhost/api/admin/trades?${query}` };
  const response = (await GET(request as never)) as Response;
  return (await response.json()) as TradeBody;
}

describe('GET /api/admin/trades', () => {
  beforeEach(() => {
    for (const s of [db.balanceTransaction, db.npcTrade, db.position]) {
      s.findMany.mockClear();
      s.count.mockClear();
    }
  });

  it('requires admin', async () => {
    await call('');
    expect(mockRequireAdmin).toHaveBeenCalled();
  });

  it('only queries the selected source when a type filter is set', async () => {
    const body = await call('type=npc&limit=10');
    expect(db.npcTrade.findMany).toHaveBeenCalledTimes(1);
    expect(db.balanceTransaction.findMany).not.toHaveBeenCalled();
    expect(db.position.findMany).not.toHaveBeenCalled();
    expect(body.trades.every((trade) => trade.type === 'npc')).toBe(true);
    expect(body.pagination.total).toBe(3);
  });

  it('paginates the merged timeline without skipping rows', async () => {
    const page1 = await call('limit=2&offset=0');
    const page2 = await call('limit=2&offset=2');
    const page3 = await call('limit=2&offset=4');
    expect(page1.trades.map((trade) => trade.id)).toEqual(['n6', 'b5']);
    expect(page2.trades.map((trade) => trade.id)).toEqual(['n4', 'b3']);
    expect(page3.trades.map((trade) => trade.id)).toEqual(['n2', 'b1']);
    expect(page2.pagination.hasMore).toBe(true);
    expect(page3.pagination.hasMore).toBe(false);
  });

  it('keeps ledger rows whose user no longer resolves', async () => {
    const body = await call('type=balance');
    const orphan = body.trades.find((trade) => trade.id === 'b5');
    expect(orphan).toBeDefined();
    expect(orphan?.user).toBeNull();
  });

  it('does not export a POST handler', async () => {
    const mod = await import('../route');
    expect('POST' in mod).toBe(false);
  });
});
