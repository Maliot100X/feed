import { expect, test } from 'bun:test';
import {
  sharedStateMigrationGate,
  sharedStateMigrationPaused,
} from '../../api/src/redis/shared-state-cutover';

test('migration pause rejects application traffic before it reaches storage', async () => {
  for (const path of [
    '/api/posts',
    '/api/cron/game-tick',
    '/api/sse/events',
    '/media/example',
    '/',
  ]) {
    for (const method of ['GET', 'POST']) {
      const response = sharedStateMigrationGate(
        new Request(`https://example.test${path}`, { method }),
        'true',
        'fixture-secret'
      );
      expect(response?.status).toBe(503);
      expect(response?.headers.get('retry-after')).toBe('60');
      expect(response?.headers.get('cache-control')).toBe('no-store');
    }
  }
  for (const path of ['/api/health', '/__deployment'])
    expect(
      sharedStateMigrationGate(
        new Request(`https://example.test${path}`),
        'true',
        'fixture-secret'
      )
    ).toBeNull();
  expect(
    sharedStateMigrationGate(
      new Request('https://example.test/api/posts', { method: 'POST' }),
      'false',
      'fixture-secret'
    )
  ).toBeNull();
  expect(sharedStateMigrationPaused()).toBe(false);
  expect(() => sharedStateMigrationPaused('invalid')).toThrow(
    'must be true or false'
  );
});

test('storage readiness stays authenticated while paused and fails closed without its secret', () => {
  const url = 'https://example.test/__shared-state';
  for (const paused of ['true', 'false']) {
    expect(
      sharedStateMigrationGate(new Request(url), paused, 'fixture-secret')
        ?.status
    ).toBe(401);
    expect(
      sharedStateMigrationGate(
        new Request(url, { headers: { authorization: 'Bearer development' } }),
        paused,
        'fixture-secret'
      )?.status
    ).toBe(401);
    expect(
      sharedStateMigrationGate(
        new Request(url, { headers: { authorization: 'Bearer ' } }),
        paused,
        undefined
      )?.status
    ).toBe(401);
    expect(
      sharedStateMigrationGate(
        new Request(url, {
          headers: { authorization: 'Bearer fixture-secret' },
        }),
        paused,
        'fixture-secret'
      )
    ).toBeNull();
    expect(
      sharedStateMigrationGate(
        new Request(url, {
          method: 'POST',
          headers: { authorization: 'Bearer fixture-secret' },
        }),
        paused,
        'fixture-secret'
      )?.status
    ).toBe(405);
  }
});
