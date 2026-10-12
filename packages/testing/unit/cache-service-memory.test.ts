/**
 * In-memory cache invalidation must match keys exactly like Redis SCAN MATCH:
 * namespace-scoped glob patterns, not substring matching.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  cacheGlobToRegExp,
  clearAllCache,
  getCache,
  invalidateCachePattern,
  setCache,
} from '../../api/src/cache/cache-service';

describe('cache-service memory pattern invalidation', () => {
  beforeEach(async () => {
    await clearAllCache();
  });

  test('a user-prefixed pattern only removes that user', async () => {
    await setCache('123:profile', 'a', { namespace: 'user' });
    await setCache('1234:profile', 'b', { namespace: 'user' });
    await setCache('9123:profile', 'c', { namespace: 'user' });

    await invalidateCachePattern('123:*', { namespace: 'user' });

    expect(
      await getCache<string>('123:profile', { namespace: 'user' })
    ).toBeNull();
    expect(await getCache<string>('1234:profile', { namespace: 'user' })).toBe(
      'b'
    );
    expect(await getCache<string>('9123:profile', { namespace: 'user' })).toBe(
      'c'
    );
  });

  test('a wildcard is scoped to its namespace', async () => {
    await setCache('1', 'user-1', { namespace: 'user' });
    await setCache('1', 'post-1', { namespace: 'post' });

    await invalidateCachePattern('*', { namespace: 'user' });

    expect(await getCache<string>('1', { namespace: 'user' })).toBeNull();
    expect(await getCache<string>('1', { namespace: 'post' })).toBe('post-1');
  });

  test('glob conversion escapes regex metacharacters', () => {
    const matcher = cacheGlobToRegExp('feed:a.b?(c)*');
    expect(matcher.test('feed:a.bX(c)anything')).toBe(true);
    expect(matcher.test('feed:aXbX(c)')).toBe(false);
    expect(matcher.test('prefix-feed:a.bX(c)')).toBe(false);
  });
});
