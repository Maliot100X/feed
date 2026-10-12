import { beforeEach, describe, expect, it, mock } from 'bun:test';

const calls: Array<{ url: string; auth: boolean | undefined }> = [];
const fetchMock = mock((url: string, init?: { auth?: boolean }) => {
  calls.push({ url, auth: init?.auth });
  const viewer = new URL(url, 'https://x.test').searchParams.get('userId');
  return Promise.resolve(
    new Response(
      JSON.stringify({ questions: [{ id: 1, viewer: viewer ?? 'anon' }] }),
      { status: 200 }
    )
  );
});

mock.module('@/utils/api-fetch', () => ({
  apiFetch: (url: string, init?: { auth?: boolean }) => fetchMock(url, init),
}));

const { usePredictionMarketsStore } = await import('./predictionMarketsStore');
const store = () => usePredictionMarketsStore.getState();

beforeEach(() => {
  calls.length = 0;
  usePredictionMarketsStore.setState({
    markets: [],
    lastFetchedAt: null,
    viewerKey: null,
    fetchPromise: null,
  });
});

describe('predictionMarketsStore', () => {
  it('does not reuse a cached response across viewers and authenticates private requests', async () => {
    await store().fetchMarkets(false, 'user-a');
    await store().fetchMarkets(false, 'user-b');
    await store().fetchMarkets(false, 'user-b'); // cached

    expect(calls.map((c) => c.url)).toEqual([
      '/api/markets/predictions?userId=user-a',
      '/api/markets/predictions?userId=user-b',
    ]);
    expect(calls.every((c) => c.auth === true)).toBe(true);
    expect((store().markets[0] as unknown as { viewer: string }).viewer).toBe(
      'user-b'
    );
  });

  it('caches an empty list instead of refetching', async () => {
    fetchMock.mockImplementationOnce((url: string) => {
      calls.push({ url, auth: false });
      return Promise.resolve(
        new Response(JSON.stringify({ questions: [] }), { status: 200 })
      );
    });
    await store().fetchMarkets();
    await store().fetchMarkets();
    expect(calls).toHaveLength(1);
  });
});
