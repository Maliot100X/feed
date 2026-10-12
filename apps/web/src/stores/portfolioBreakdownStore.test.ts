import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const fetchMock = mock((_url: string) =>
  Promise.resolve(new Response(JSON.stringify({ wallet: 1 }), { status: 200 }))
);

mock.module('@/utils/api-fetch', () => ({
  apiFetch: (url: string) => fetchMock(url),
}));

const { usePortfolioBreakdownStore } = await import(
  './portfolioBreakdownStore'
);

const store = () => usePortfolioBreakdownStore.getState();

beforeEach(() => {
  store().reset();
  fetchMock.mockClear();
});

afterEach(() => {
  store().reset();
});

describe('portfolioBreakdownStore subscriptions', () => {
  it('restarts polling for B while A is still mounted, ignoring stale A cleanup', () => {
    const unsubA = store().subscribe('A', 60_000);
    const intervalA = store().pollingInterval;
    const unsubB = store().subscribe('B', 60_000);

    expect(store().pollingUserId).toBe('B');
    expect(store().subscriberCount).toBe(1);
    expect(store().pollingInterval).not.toBeNull();
    expect(store().pollingInterval).not.toBe(intervalA);

    unsubA(); // stale cleanup from the previous user
    expect(store().subscriberCount).toBe(1);
    expect(store().pollingInterval).not.toBeNull();

    unsubB();
    expect(store().subscriberCount).toBe(0);
    expect(store().pollingInterval).toBeNull();
  });

  it('makes unsubscribe idempotent', () => {
    const first = store().subscribe('A', 60_000);
    const second = store().subscribe('A', 60_000);
    expect(store().subscriberCount).toBe(2);

    first();
    first();
    expect(store().subscriberCount).toBe(1);
    expect(store().pollingInterval).not.toBeNull();

    second();
    expect(store().pollingInterval).toBeNull();
  });
});

describe('portfolioBreakdownStore fetch identity', () => {
  it('discards an older response after an A -> B -> A switch', async () => {
    const resolvers: Array<(r: Response) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        })
    );

    store().setUserId('A');
    const first = store().fetchPortfolioBreakdown('A');
    store().setUserId('B');
    store().setUserId('A');
    const second = store().fetchPortfolioBreakdown('A');

    resolvers[1]?.(
      new Response(JSON.stringify({ wallet: 2 }), { status: 200 })
    );
    await second;
    resolvers[0]?.(
      new Response(JSON.stringify({ wallet: 1 }), { status: 200 })
    );
    await first;

    expect(store().data?.wallet).toBe(2);
    expect(store().loading).toBe(false);
    expect(store().fetchPromise).toBeNull();
  });
});
