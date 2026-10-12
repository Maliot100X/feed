import { describe, expect, test } from 'bun:test';
import { db, eq, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';
import { createStewardTestToken } from './helpers/steward-auth';

const baseUrl =
  process.env.TEST_API_URL ||
  process.env.TEST_BASE_URL ||
  'http://127.0.0.1:3100';

describe('retired collectible NFT integration', () => {
  test('gallery, minting, holdings, and token-gated routes are absent', async () => {
    for (const path of [
      '/nft',
      '/nft/1',
      '/api/nft/gallery',
      '/api/nft/collection',
      '/api/nft/1',
      '/api/nft/image/1',
      '/api/nft/metadata/1',
      '/api/nft/eligibility',
      '/api/nft/holdings',
      '/api/nft/mint/prepare',
      '/api/nft/mint/execute',
      '/api/nft/mint/confirm',
      '/api/nft/chat/ensure',
      '/api/wallet/nfts',
      '/api/chats/123/join-nft',
      '/api/chats/123/nft-verification',
      '/api/admin/groups/nft-collection',
      '/api/admin/groups/123/revalidate-nft',
      '/api/cron/nft-revalidate',
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

  test('legacy gating requests cannot silently create unrestricted groups', async () => {
    const userId = await generateSnowflakeId();
    await db.insert(users).values({
      id: userId,
      stewardId: `retired-nft-${userId}`,
      username: `retired-nft-${userId}`,
      updatedAt: new Date(),
    });
    try {
      const retiredListing = await fetch(`${baseUrl}/api/chats/nft-gated`, {
        headers: {
          Authorization: `Bearer ${await createStewardTestToken(`retired-nft-${userId}`)}`,
        },
      });
      expect(retiredListing.status).toBe(404);
      for (const path of ['/api/chats', '/api/groups']) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await createStewardTestToken(`retired-nft-${userId}`)}`,
          },
          body: JSON.stringify({
            name: 'Retired gated group',
            ...(path === '/api/chats' ? { isGroup: true } : {}),
            requiredNftContractAddress:
              '0x0000000000000000000000000000000000000001',
            requiredNftChainId: 1,
          }),
        });
        expect(response.status, path).toBe(400);
        expect(JSON.stringify(await response.json())).toContain(
          'requiredNftContractAddress'
        );
      }
    } finally {
      await db.delete(users).where(eq(users.id, userId));
    }
  });
});
