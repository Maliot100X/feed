/**
 * Privacy/authorization guarantees for user API routes, exercised through the
 * real route handlers with data access faked.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Ctx = { params: Promise<{ userId: string }> };
type Handler = (request: NextRequest, context: Ctx) => Promise<Response>;

let profileRow: Row | null = null;
let authUserId = 'user-1';
const dbUpdates: Row[] = [];
let selectRows: Row[] = [];

function selectChain() {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: async () => selectRows,
  };
  return builder;
}

const fakeDb = {
  select: () => selectChain(),
  update: () => ({
    set: (payload: Row) => {
      dbUpdates.push(payload);
      return {
        where: () => ({ returning: async () => [] }),
      };
    },
  }),
};

const actualDb = await import('@feed/db');
mock.module('@feed/db', () => ({ ...actualDb, db: fakeDb }));

const getReferralEarningsMock = mock(async () => ({
  totalEarned: 0,
  totalReferrals: 0,
  topReferrals: [],
  recentFees: [],
}));
const actualEngine = await import('@feed/engine');
mock.module('@feed/engine', () => ({
  ...actualEngine,
  FeeService: { getReferralEarnings: getReferralEarningsMock },
}));

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticate: async () => ({
    userId: authUserId,
    dbUserId: authUserId,
    privyId: authUserId,
  }),
  requireUserByIdentifier: async (id: string) => ({ id }),
  findUserByIdentifier: async () => profileRow,
  publicRateLimit: async () => ({ error: null, rateLimitInfo: null }),
  withErrorHandling: (handler: Handler) => handler,
}));

const profileStatsPath = new URL(
  '../../../apps/web/src/lib/users/profile-stats.ts',
  import.meta.url
).pathname;
mock.module(profileStatsPath, () => ({
  getOptionalProfileStats: async () => null,
}));

const profileRoute = await import(
  '../../../apps/web/src/app/api/users/[userId]/profile/route'
);
const referralFeesRoute = await import(
  '../../../apps/web/src/app/api/users/[userId]/referral-fees/route'
);
const emailPrefsRoute = await import(
  '../../../apps/web/src/app/api/users/[userId]/notification-email-preferences/route'
);

const ctx = (userId: string): Ctx => ({ params: Promise.resolve({ userId }) });

function profileUser(overrides: Row): Row {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'user-1',
    walletAddress: '0xabc',
    twitterUsername: 'alice_x',
    hasTwitter: true,
    showWalletPublic: true,
    showTwitterPublic: true,
    virtualBalance: '0',
    lifetimePnL: '0',
    usernameChangedAt: null,
    createdAt: now,
    ...overrides,
  };
}

describe('GET /api/users/[userId]/profile visibility', () => {
  test('hides wallet and twitter handle when the owner opted out', async () => {
    profileRow = profileUser({
      showWalletPublic: false,
      showTwitterPublic: false,
    });

    const response = await profileRoute.GET(
      new NextRequest('https://feed.fun/api/users/user-1/profile'),
      ctx('user-1')
    );
    const body = (await response.json()) as { user: Row };

    expect(body.user.walletAddress).toBeNull();
    expect(body.user.twitterUsername).toBeNull();
  });

  test('returns wallet and twitter handle when public', async () => {
    profileRow = profileUser({});

    const response = await profileRoute.GET(
      new NextRequest('https://feed.fun/api/users/user-1/profile'),
      ctx('user-1')
    );
    const body = (await response.json()) as { user: Row };

    expect(body.user.walletAddress).toBe('0xabc');
    expect(body.user.twitterUsername).toBe('alice_x');
  });
});

describe('GET /api/users/[userId]/referral-fees', () => {
  test("returns 403 (AuthorizationError) for another user's fees", async () => {
    authUserId = 'user-1';
    getReferralEarningsMock.mockClear();

    const error = await referralFeesRoute
      .GET(
        new NextRequest('https://feed.fun/api/users/user-2/referral-fees'),
        ctx('user-2')
      )
      .then(
        () => null,
        (err: unknown) => err
      );

    expect(error).toBeInstanceOf(actualApi.AuthorizationError);
    expect((error as { statusCode: number }).statusCode).toBe(403);
    expect(getReferralEarningsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/users/[userId]/notification-email-preferences', () => {
  beforeEach(() => {
    authUserId = 'user-1';
    dbUpdates.length = 0;
    selectRows = [{ email: 'alice@example.com', emailVerified: true }];
  });

  function post(body: Row) {
    return emailPrefsRoute.POST(
      new NextRequest(
        'https://feed.fun/api/users/user-1/notification-email-preferences',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      ),
      ctx('user-1')
    );
  }

  test('rejects a payload that disables notifications but enables a summary', async () => {
    await expect(post({ enabled: false, dailySummary: true })).rejects.toThrow(
      'Cannot enable an email summary while disabling email notifications'
    );
    expect(dbUpdates).toHaveLength(0);
  });

  test('refuses to enable delivery without a verified email', async () => {
    selectRows = [{ email: 'alice@example.com', emailVerified: false }];

    await expect(post({ enabled: true })).rejects.toThrow(
      'No verified email was found on your account'
    );
    expect(dbUpdates).toHaveLength(0);
  });
});
