import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

const ensureEngineServicesMock = mock(() => undefined);
const relayCronToStagingMock = mock(async () => ({ forwarded: false }));

const ensureEngineServicesPath = new URL(
  '../../../../apps/web/src/lib/engine/ensure-engine-services.ts',
  import.meta.url
).pathname;
mock.module(ensureEngineServicesPath, () => ({
  ensureEngineServices: ensureEngineServicesMock,
}));

const actualFeedApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualFeedApi,
  relayCronToStaging: relayCronToStagingMock,
  withErrorHandling:
    (handler: (request: NextRequest) => Promise<Response>) =>
    (request: NextRequest) =>
      handler(request),
}));

const { GET, POST } = await import(
  '../../../../apps/web/src/app/api/cron/game-tick/route'
);

describe('game-tick cron auth', () => {
  beforeEach(() => {
    ensureEngineServicesMock.mockClear();
    relayCronToStagingMock.mockClear();
  });

  test('GET uses the same handler as POST', () => {
    expect(GET).toBe(POST);
  });

  test('a vercel-cron user-agent is not accepted as a credential', async () => {
    const request = new NextRequest('https://feed.fun/api/cron/game-tick', {
      method: 'GET',
      headers: {
        'user-agent': 'vercel-cron/1.0',
        'x-vercel-id': 'spoofed',
        authorization: 'Bearer wrong-secret',
      },
    });

    await expect(GET(request)).rejects.toThrow('Unauthorized cron request');
    expect(ensureEngineServicesMock).not.toHaveBeenCalled();
    expect(relayCronToStagingMock).not.toHaveBeenCalled();
  });
});
