import { describe, expect, test } from 'bun:test';
import { db, eq, shareActions, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';
import { createStewardTestToken } from './helpers/steward-auth';

const baseUrl =
  process.env.TEST_API_URL ||
  process.env.TEST_BASE_URL ||
  'http://127.0.0.1:3100';

describe('retired social integration', () => {
  test('login, follow, frame and manifest endpoints are absent', async () => {
    for (const path of [
      '/api/auth/farcaster',
      '/api/auth/farcaster/callback',
      '/api/auth/farcaster-miniapp',
      '/api/auth/onboarding/farcaster/callback',
      '/api/users/123/verify-farcaster-follow',
      '/api/frame',
      '/api/frame/metadata',
      '/.well-known/farcaster.json',
      '/farcaster.json',
      '/farcaster-hosted-template.json',
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      expect(response.status, path).toBe(404);
      if (path.startsWith('/api/')) {
        const post = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        expect(post.status, `POST ${path}`).toBe(404);
      }
    }
  }, 60000);
  test('credentials status only advertises supported integrations', async () => {
    const response = await fetch(`${baseUrl}/api/auth/credentials/status`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('twitter');
    expect(body).not.toHaveProperty('farcaster');
  });
  test('data exports retain supported account data without retired social fields', async () => {
    const userId = await generateSnowflakeId();
    await db.insert(users).values({
      id: userId,
      stewardId: `retired-social-${userId}`,
      privyId: `did:privy:test-${userId}`,
      username: `export-social-${userId}`,
      hasTwitter: true,
      twitterUsername: 'supported-account',
      updatedAt: new Date(),
    });
    try {
      const response = await fetch(`${baseUrl}/api/users/export-data`, {
        headers: {
          Authorization: `Bearer ${await createStewardTestToken(`retired-social-${userId}`)}`,
        },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.personal_information.id).toBe(userId);
      expect(body.personal_information.twitterUsername).toBe(
        'supported-account'
      );
      expect(
        Object.keys(body.personal_information).some((key) =>
          key.toLowerCase().includes('farcaster')
        )
      ).toBe(false);
    } finally {
      await db.delete(users).where(eq(users.id, userId));
    }
  });
  test('a historical share cannot be verified under a different platform', async () => {
    const userId = await generateSnowflakeId();
    const shareId = await generateSnowflakeId();
    const privyId = `did:privy:test-${userId}`;
    await db.insert(users).values({
      id: userId,
      stewardId: `retired-social-${userId}`,
      privyId,
      username: `retired-social-${userId}`,
      updatedAt: new Date(),
    });
    try {
      await db.insert(shareActions).values({
        id: shareId,
        userId,
        platform: 'farcaster',
        contentType: 'profile',
      });
      const response = await fetch(
        `${baseUrl}/api/users/${userId}/verify-share`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await createStewardTestToken(`retired-social-${userId}`)}`,
          },
          body: JSON.stringify({
            shareId,
            platform: 'twitter',
            postUrl: 'https://x.com/test/status/12345',
          }),
        }
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain(
        'Share platform does not match the verification platform'
      );
      const [stored] = await db
        .select()
        .from(shareActions)
        .where(eq(shareActions.id, shareId));
      expect(stored?.verified).toBe(false);
      expect(stored?.pointsAwarded).toBe(false);
    } finally {
      await db.delete(shareActions).where(eq(shareActions.id, shareId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });
});
