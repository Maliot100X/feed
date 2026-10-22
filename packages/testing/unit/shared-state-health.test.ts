import { expect, test } from 'bun:test';
import {
  checkCloudflareState,
  createSharedStateHealth,
  requiresRedis,
  SHARED_STATE_BACKENDS,
  selectedStateBackends,
} from '../../api/src/redis/shared-state-health';

test('Redis is required until every shared state backend is explicitly migrated', () => {
  expect(requiresRedis({})).toBe(true);
  const env = Object.fromEntries(
    SHARED_STATE_BACKENDS.map(({ flag }) => [flag, 'cloudflare'])
  );
  expect(requiresRedis(env)).toBe(false);
  for (const { flag } of SHARED_STATE_BACKENDS) {
    expect(requiresRedis({ ...env, [flag]: 'redis' })).toBe(true);
    const missing = { ...env };
    delete missing[flag];
    expect(requiresRedis(missing)).toBe(true);
    expect(() => selectedStateBackends({ ...env, [flag]: 'invalid' })).toThrow(
      'Unsupported'
    );
  }
});

test('failed, malformed and rejected health probes cannot report shared storage healthy', async () => {
  const health = createSharedStateHealth([
    {
      name: 'good',
      provider: 'cloudflare',
      check: () => checkCloudflareState(Response.json({ healthy: true })),
    },
    {
      name: 'bad',
      provider: 'cloudflare',
      check: () => checkCloudflareState(Response.json({ healthy: false })),
    },
    {
      name: 'http-error',
      provider: 'cloudflare',
      check: () =>
        checkCloudflareState(new Response('unavailable', { status: 503 })),
    },
    {
      name: 'missing-binding',
      provider: 'cloudflare',
      async check() {
        throw new Error('Binding unavailable');
      },
    },
    {
      name: 'redis',
      provider: 'redis',
      async check() {
        return true;
      },
    },
  ]);
  const result = await health.check();
  expect(result.healthy).toBe(false);
  expect(result.backends.map((backend) => backend.healthy)).toEqual([
    true,
    false,
    false,
    false,
    true,
  ]);
  expect(() => createSharedStateHealth([])).toThrow('required');
});
