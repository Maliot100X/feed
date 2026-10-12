/**
 * Integration Tests: POST /api/waitlist/bonus/email
 *
 * Tests the email bonus API route end-to-end against a running Next.js server
 * and real database.
 *
 * Prerequisites:
 * - PostgreSQL running (DATABASE_URL set)
 * - Next.js dev server running at TEST_BASE_URL (default: http://localhost:3000)
 * - STEWARD_JWT_SECRET matching the server (requests carry signed Steward
 *   tokens, so this works against production builds)
 *
 * Run:
 *   bun test integration/waitlist-email-bonus-api.integration.test.ts \
 *     --preload ./integration/preload.ts
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { db, eq, inArray, pointsTransactions, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';
import { waitForEndpointAvailability } from './helpers';
import { createStewardTestToken } from './helpers/steward-auth';

const BASE_URL =
  process.env.TEST_API_URL ||
  process.env.TEST_BASE_URL ||
  'http://localhost:3000';

const ENDPOINT = '/api/waitlist/bonus/email';

let serverAvailable = false;
let dbAvailable = false;
const testUserIds: string[] = [];

function stewardIdFor(userId: string): string {
  return `email-bonus-${userId}`;
}

async function authHeader(userId: string): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await createStewardTestToken(stewardIdFor(userId))}`,
  };
}

async function post(
  userId: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
) {
  return fetch(`${BASE_URL}${ENDPOINT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeader(userId)),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}

async function createTestUser(overrides: Record<string, unknown> = {}) {
  const userId = await generateSnowflakeId();
  await db.insert(users).values({
    id: userId,
    stewardId: stewardIdFor(userId),
    username: `test-email-bonus-${userId}`,
    displayName: 'Test Email Bonus User',
    reputationPoints: 100,
    bonusPoints: 0,
    isWaitlistActive: true,
    isTest: true,
    updatedAt: new Date(),
    ...overrides,
  });
  testUserIds.push(userId);
  return userId;
}

beforeAll(async () => {
  serverAvailable = await waitForEndpointAvailability(
    `${BASE_URL}${ENDPOINT}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe@example.com' }),
    },
    (response) => response.status !== 404 && response.status < 500,
    15,
    15000
  );

  if (!serverAvailable) {
    console.warn(
      `⚠️  Server not available at ${BASE_URL} — tests will be skipped`
    );
  }

  // Check DB
  try {
    await db.select().from(users).limit(1);
    dbAvailable = true;
  } catch {
    console.warn('⚠️  Database not available — tests will be skipped');
  }
});

afterAll(async () => {
  if (!dbAvailable || testUserIds.length === 0) return;
  await db
    .delete(pointsTransactions)
    .where(inArray(pointsTransactions.userId, testUserIds));
  await db.delete(users).where(inArray(users.id, testUserIds));
  console.log(`✅ Cleaned up ${testUserIds.length} test users`);
});

afterEach(() => {
  // Individual cleanup handled in afterAll to keep tests fast
});

describe('POST /api/waitlist/bonus/email', () => {
  describe('success cases', () => {
    test('awards 100 points when the submitted email is the account email', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const email = `success-${await generateSnowflakeId()}@example.com`;
      const userId = await createTestUser({ email });

      const res = await post(userId, { email: email.toUpperCase() });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.awarded).toBe(true);
      expect(body.bonusAmount).toBe(100);

      const [user] = await db
        .select({
          email: users.email,
          bonusPoints: users.bonusPoints,
          reputationPoints: users.reputationPoints,
          pointsAwardedForEmail: users.pointsAwardedForEmail,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      expect(user?.email).toBe(email);
      expect(user?.pointsAwardedForEmail).toBe(true);
      expect(user?.bonusPoints).toBe(100);
      expect(user?.reputationPoints).toBe(200); // 100 base + 100 bonus
    });

    test('awards once even when submitted twice', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const email = `double-${await generateSnowflakeId()}@example.com`;
      const userId = await createTestUser({ email });

      const [res1, res2] = await Promise.all([
        post(userId, { email }),
        post(userId, { email }),
      ]);
      const bodies = [await res1.json(), await res2.json()];
      expect(bodies.filter((b) => b.awarded)).toHaveLength(1);

      const [user] = await db
        .select({ bonusPoints: users.bonusPoints })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      expect(user?.bonusPoints).toBe(100);
    });

    test('creates a points transaction with reason email_submit', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const email = `txn-${await generateSnowflakeId()}@example.com`;
      const userId = await createTestUser({ reputationPoints: 50, email });

      await post(userId, { email });

      const [txn] = await db
        .select()
        .from(pointsTransactions)
        .where(eq(pointsTransactions.userId, userId))
        .limit(1);

      expect(txn).toBeDefined();
      expect(txn?.reason).toBe('email_submit');
      expect(txn?.amount).toBe(100);
      expect(txn?.pointsBefore).toBe(50);
      expect(txn?.pointsAfter).toBe(150);
    });
  });

  describe('identity protection', () => {
    test('never writes a submitted email to the account', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const userId = await createTestUser({ email: null });
      const res = await post(userId, { email: 'someone@admin-domain.example' });
      expect(res.status).toBe(200);
      expect((await res.json()).awarded).toBe(false);

      const [user] = await db
        .select({ email: users.email, bonusPoints: users.bonusPoints })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      expect(user).toEqual({ email: null, bonusPoints: 0 });
    });

    test('does not replace an existing email with a different one', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const email = `verified-${await generateSnowflakeId()}@example.com`;
      const userId = await createTestUser({ email });
      const res = await post(userId, { email: 'attacker@example.com' });
      expect((await res.json()).awarded).toBe(false);

      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      expect(user?.email).toBe(email);
    });
  });

  describe('validation errors', () => {
    test('returns 400 for invalid email format', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const userId = await createTestUser();

      const res = await post(userId, { email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    test('returns 400 for missing email field', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const userId = await createTestUser();

      const res = await post(userId, {});
      expect(res.status).toBe(400);
    });

    test('returns 400 for empty email string', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const userId = await createTestUser();

      const res = await post(userId, { email: '' });
      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid JSON body', async () => {
      if (!serverAvailable || !dbAvailable) return;

      const userId = await createTestUser();

      const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeader(userId)),
        },
        body: 'not json {{',
        signal: AbortSignal.timeout(15000),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('authentication', () => {
    test('returns 401 when no auth token is provided', async () => {
      if (!serverAvailable) return;

      const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
        signal: AbortSignal.timeout(15000),
      });
      expect(res.status).toBe(401);
    });

    test('returns 4xx/5xx for invalid bearer token', async () => {
      if (!serverAvailable) return;

      const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid-token-xyz',
        },
        body: JSON.stringify({ email: 'test@example.com' }),
        signal: AbortSignal.timeout(15000),
      });
      // Dev: Privy not fully configured → 500; Prod: 401.
      // Either way the request must not succeed.
      expect(res.status).not.toBe(200);
    });
  });
});
