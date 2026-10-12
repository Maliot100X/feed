import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

class AuthenticationError extends Error {}

const authenticateMock = mock(async (): Promise<{ userId: string }> => {
  throw new AuthenticationError('Missing authentication token');
});
const checkRateLimitAsyncMock = mock(async () => ({
  allowed: true,
  retryAfter: 0,
}));
const generateJSONMock = mock(async () => ({
  name: 'Cyber Chad',
  username: 'Cyber Chad!!',
  bio: 'WAGMI',
}));
let takenUsernames: string[] = [];
const selectWhereMock = mock(async () =>
  takenUsernames.map((username) => ({ username }))
);

const apiModulePath = new URL(
  '../../../../../../../packages/api/src/index.ts',
  import.meta.url
).pathname;
const apiModuleFactory = () => ({
  addPublicReadHeaders: (response: Response) => response,
  authenticate: authenticateMock,
  checkRateLimitAsync: checkRateLimitAsyncMock,
  errorResponse: (message: string, code: string, status: number) =>
    Response.json({ error: message, code }, { status }),
  publicRateLimit: async () => ({ error: null, user: null }),
  RATE_LIMIT_CONFIGS: {
    GENERATE_ONBOARDING_PROFILE: {
      maxRequests: 5,
      windowMs: 60000,
      actionType: 'generate_onboarding_profile',
    },
  },
  rateLimitError: () => Response.json({ error: 'limited' }, { status: 429 }),
  successResponse: (body: object) => Response.json(body),
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
});

const dbModulePath = new URL(
  '../../../../../../../packages/db/src/index.ts',
  import.meta.url
).pathname;
const dbModuleFactory = () => ({
  db: {
    select: () => ({ from: () => ({ where: selectWhereMock }) }),
  },
  inArray: () => undefined,
  users: { username: 'username' },
});

const engineModulePath = new URL(
  '../../../../../../../packages/engine/src/index.ts',
  import.meta.url
).pathname;
const engineModuleFactory = () => ({
  FeedLLMClient: { forGameTick: () => ({ generateJSON: generateJSONMock }) },
});

mock.module('@feed/api', apiModuleFactory);
mock.module(apiModulePath, apiModuleFactory);
mock.module('@feed/db', dbModuleFactory);
mock.module(dbModulePath, dbModuleFactory);
mock.module('@feed/engine', engineModuleFactory);
mock.module(engineModulePath, engineModuleFactory);

describe('POST /api/onboarding/generate-profile', () => {
  beforeEach(() => {
    authenticateMock.mockClear();
    generateJSONMock.mockClear();
    checkRateLimitAsyncMock.mockClear();
  });

  it('requires authentication before invoking the LLM', async () => {
    const { POST } = await import('../generate-profile/route');
    await expect(
      POST(
        new NextRequest('https://feed.example/api/onboarding/generate-profile')
      )
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(generateJSONMock).not.toHaveBeenCalled();
  });

  it('does not invoke the LLM when rate limited', async () => {
    authenticateMock.mockImplementationOnce(async () => ({ userId: 'u1' }));
    checkRateLimitAsyncMock.mockImplementationOnce(async () => ({
      allowed: false,
      retryAfter: 30,
    }));
    const { POST } = await import('../generate-profile/route');
    const response = await POST(
      new NextRequest('https://feed.example/api/onboarding/generate-profile')
    );
    expect(response.status).toBe(429);
    expect(generateJSONMock).not.toHaveBeenCalled();
  });

  it('returns a validated, sanitized profile for authenticated users', async () => {
    authenticateMock.mockImplementationOnce(async () => ({ userId: 'u1' }));
    const { POST } = await import('../generate-profile/route');
    const response = await POST(
      new NextRequest('https://feed.example/api/onboarding/generate-profile')
    );
    const body = (await response.json()) as { username: string; name: string };
    expect(response.status).toBe(200);
    expect(body.username).toBe('cyber_chad__');
    expect(body.name).toBe('Cyber Chad');
  });
});

describe('GET /api/onboarding/check-username', () => {
  beforeEach(() => {
    takenUsernames = [];
    selectWhereMock.mockClear();
  });

  it('validates the normalized username, not the raw input', async () => {
    const { GET } = await import('../check-username/route');
    const response = await GET(
      new NextRequest(
        'https://feed.example/api/onboarding/check-username?username=%40ab'
      )
    );
    expect(response.status).toBe(400);
    expect(selectWhereMock).not.toHaveBeenCalled();
  });

  it('suggests a bounded, valid-length alternative with one query', async () => {
    const base = 'abcdefghijklmnopqrst'; // 20 chars
    takenUsernames = [base, 'abcdefghijklmnopqrs1'];
    const { GET } = await import('../check-username/route');
    const response = await GET(
      new NextRequest(
        `https://feed.example/api/onboarding/check-username?username=${base}`
      )
    );
    const body = (await response.json()) as {
      available: boolean;
      suggestion?: string;
    };
    expect(body.available).toBe(false);
    expect(body.suggestion).toBe('abcdefghijklmnopqrs2');
    expect(body.suggestion?.length).toBeLessThanOrEqual(20);
    expect(selectWhereMock).toHaveBeenCalledTimes(1);
  });

  it('returns no suggestion when every candidate is taken', async () => {
    takenUsernames = ['alice'];
    for (let n = 1; n <= 25; n++) takenUsernames.push(`alice${n}`);
    const { GET } = await import('../check-username/route');
    const response = await GET(
      new NextRequest(
        'https://feed.example/api/onboarding/check-username?username=alice'
      )
    );
    const body = (await response.json()) as { suggestion?: string };
    expect(body.suggestion).toBeUndefined();
  });
});
