import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  mock,
  spyOn,
} from 'bun:test';
import { NextRequest } from 'next/server';

const breakingNewsGetMock = mock(async (_req: NextRequest) =>
  Response.json({
    success: true,
    news: [
      {
        id: 'n1',
        title: 'Headline',
        description: 'Body',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
);

const perpSnapshotMock = mock(async () => [
  { ticker: 'FLAT', currentPrice: 100, price24hAgo: 100 },
  { ticker: 'UP', currentPrice: 110, price24hAgo: 100 },
  { ticker: 'NEW', currentPrice: 50, price24hAgo: undefined },
]);

const apiModulePath = new URL(
  '../../../../../../packages/api/src/index.ts',
  import.meta.url
).pathname;

const apiModuleFactory = () => ({
  addPublicReadHeaders: (response: Response) => response,
  publicRateLimit: async () => ({ error: null, user: null }),
  successResponse: (body: object) => Response.json(body),
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
});

mock.module('@feed/api', apiModuleFactory);
mock.module(apiModulePath, apiModuleFactory);
mock.module('../feed/widgets/breaking-news/route', () => ({
  GET: breakingNewsGetMock,
}));
mock.module('../markets/perps/_adapters', () => ({
  createPerpMarketService: () => ({ getMarketsSnapshot: perpSnapshotMock }),
}));

let fetchMock: Mock<typeof fetch>;

async function loadGetHandler(): Promise<
  (req: NextRequest) => Promise<Response>
> {
  const module = await import(`./route?test=${Date.now()}`);
  return module.GET;
}

describe('GET /api/ticker', () => {
  beforeEach(() => {
    breakingNewsGetMock.mockClear();
    fetchMock = spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('never makes an outbound fetch based on forwarded headers', async () => {
    const GET = await loadGetHandler();
    const response = await GET(
      new NextRequest('https://feed.example/api/ticker?streams=news', {
        headers: {
          'x-forwarded-host': 'attacker.internal',
          'x-forwarded-proto': 'http',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(breakingNewsGetMock).toHaveBeenCalledTimes(1);
    const [innerReq] = breakingNewsGetMock.mock.calls[0] ?? [];
    expect(new URL(innerReq?.url ?? '').host).toBe('feed.example');

    const body = (await response.json()) as {
      news: Array<{ id: string; summary: string }>;
    };
    expect(body.news).toEqual([
      expect.objectContaining({ id: 'n1', summary: 'Body' }),
    ]);
  });

  it('preserves a real zero 24h change and null without a reference', async () => {
    const GET = await loadGetHandler();
    const response = await GET(
      new NextRequest('https://feed.example/api/ticker?streams=perps')
    );
    const body = (await response.json()) as {
      perps: Array<{ ticker: string; changePercent24h: number | null }>;
    };

    expect(body.perps.map((p) => [p.ticker, p.changePercent24h])).toEqual([
      ['FLAT', 0],
      ['UP', 10],
      ['NEW', null],
    ]);
  });
});
