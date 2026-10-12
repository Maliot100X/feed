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

const apiModulePath = new URL(
  '../../../../../../../../packages/api/src/index.ts',
  import.meta.url
).pathname;
const apiModuleFactory = () => ({
  authenticate: async () => ({ userId: 'u1', dbUserId: 'u1' }),
  requireUserByIdentifier: async () => ({
    id: 'u1',
    username: 'alice',
    twitterAccessToken: 'token',
    twitterUsername: 'alice',
  }),
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
});
mock.module('@feed/api', apiModuleFactory);
mock.module(apiModulePath, apiModuleFactory);

let fetchMock: Mock<typeof fetch>;

function post(body: string): NextRequest {
  // Cookie-authenticated request: no Authorization header.
  return new NextRequest('https://feed.example/api/twitter/tweet', {
    method: 'POST',
    body,
  });
}

describe('POST /api/twitter/tweet', () => {
  beforeEach(() => {
    fetchMock = spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('rejects a null body before calling the provider', async () => {
    const { POST } = await import('../route');
    await expect(POST(post('null'))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('succeeds for cookie auth without a self-HTTP tracking call', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ data: { id: '12345', text: 'hi' } })
    );
    const { POST } = await import('../route');
    const response = await POST(
      post('{"text":"hi","contentType":"market","contentId":"m1"}')
    );
    const body = (await response.json()) as { tweetUrl: string };

    expect(response.status).toBe(200);
    expect(body.tweetUrl).toBe('https://x.com/alice/status/12345');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown outcome when the provider returns no id', async () => {
    fetchMock.mockImplementation(async () => Response.json({}));
    const { POST } = await import('../route');
    const response = await POST(post('{"text":"hi"}'));
    expect(response.status).toBe(502);
  });

  it('does not forward provider error bodies', async () => {
    fetchMock.mockImplementation(
      async () => new Response('secret provider detail', { status: 403 })
    );
    const { POST } = await import('../route');
    const response = await POST(post('{"text":"hi"}'));
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).not.toContain('secret provider detail');
  });
});
