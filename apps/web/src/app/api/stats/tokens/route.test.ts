import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

interface TickRow {
  tickId: string;
  tickStartedAt: Date;
  tickCompletedAt: Date;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byPromptType: object;
  byModel: object;
}

let rows: TickRow[] = [];
const publicRateLimitMock = mock(async () => ({ error: null, user: null }));

const apiModulePath = new URL(
  '../../../../../../../packages/api/src/index.ts',
  import.meta.url
).pathname;

const apiModuleFactory = () => ({
  addPublicReadHeaders: (response: Response) => response,
  CACHE_KEYS: { WIDGET: 'widget' },
  DEFAULT_TTLS: { WIDGET: 300 },
  getCacheOrFetch: async (_key: string, fetcher: () => Promise<object>) =>
    fetcher(),
  publicRateLimit: publicRateLimitMock,
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
});

const chain = {
  select: () => chain,
  from: () => chain,
  where: () => chain,
  orderBy: () => chain,
  limit: async () => rows,
};

const dbModulePath = new URL(
  '../../../../../../../packages/db/src/index.ts',
  import.meta.url
).pathname;
const dbModuleFactory = () => ({
  db: chain,
  desc: () => undefined,
  gte: () => undefined,
  tickTokenStats: { tickStartedAt: 'tickStartedAt' },
});

mock.module('@feed/api', apiModuleFactory);
mock.module(apiModulePath, apiModuleFactory);
mock.module('@feed/db', dbModuleFactory);
mock.module(dbModulePath, dbModuleFactory);

async function loadGetHandler(): Promise<
  (req: NextRequest) => Promise<Response>
> {
  const module = await import(`./route?test=${Date.now()}`);
  return module.GET;
}

const counts = {
  callCount: 2,
  totalInputTokens: 10,
  totalOutputTokens: 5,
  totalTokens: 15,
};

describe('GET /api/stats/tokens', () => {
  beforeEach(() => {
    rows = [];
    publicRateLimitMock.mockClear();
  });

  it('uses the shared public rate limiter', async () => {
    const GET = await loadGetHandler();
    await GET(new NextRequest('https://feed.example/api/stats/tokens'));
    expect(publicRateLimitMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported period and limit values', async () => {
    const GET = await loadGetHandler();
    await expect(
      GET(new NextRequest('https://feed.example/api/stats/tokens?period=year'))
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      GET(new NextRequest('https://feed.example/api/stats/tokens?limit=1.5'))
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('keeps model names that contain a colon intact', async () => {
    rows = [
      {
        tickId: 't1',
        tickStartedAt: new Date('2026-01-01T00:00:00Z'),
        tickCompletedAt: new Date('2026-01-01T00:01:00Z'),
        totalCalls: 2,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
        byPromptType: [{ promptType: 'post', ...counts }],
        byModel: [
          { provider: 'openrouter', model: 'meta/llama:free', ...counts },
        ],
      },
    ];
    const GET = await loadGetHandler();
    const response = await GET(
      new NextRequest('https://feed.example/api/stats/tokens?period=week')
    );
    const body = (await response.json()) as {
      summary: { totalTokens: number; tickCount: number };
      byModel: Array<{ model: string; provider: string }>;
    };

    expect(body.summary.tickCount).toBe(1);
    expect(body.summary.totalTokens).toBe(15);
    expect(body.byModel[0]?.model).toBe('meta/llama:free');
    expect(body.byModel[0]?.provider).toBe('openrouter');
  });
});
