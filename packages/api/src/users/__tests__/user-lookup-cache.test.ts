/**
 * Users read back from Redis (JSON) get their timestamp columns revived.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import path from 'node:path';

const createdAt = new Date('2026-02-03T04:05:06.000Z');
let lookup: typeof import('../user-lookup');

describe('user lookup cache rehydration', () => {
  beforeAll(async () => {
    const cachePath = path.resolve(
      import.meta.dir,
      '../../cache/cache-service.ts'
    );
    const actual = await import(cachePath);
    mock.module(cachePath, () => ({
      ...actual,
      // Simulate a Redis hit: the cached user went through JSON.
      getCacheOrFetch: async () =>
        JSON.parse(
          JSON.stringify({
            id: '263849173829304320',
            username: 'cached_user',
            createdAt,
            updatedAt: createdAt,
            lastDailyLogin: null,
          })
        ),
    }));
    lookup = await import('../user-lookup');
  });

  afterAll(() => {
    mock.restore();
  });

  it('returns Date objects for cached timestamp columns', async () => {
    const user = await lookup.findUserByIdentifier('263849173829304320');
    expect(user?.createdAt).toBeInstanceOf(Date);
    expect(user?.createdAt.getTime()).toBe(createdAt.getTime());
    expect(user?.lastDailyLogin).toBeNull();
  });
});
