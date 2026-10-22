import { expect, test } from 'bun:test';
import { SHARED_STATE_BACKENDS } from '../../packages/api/src/redis/shared-state-health';
import { validateSharedStateDeployment } from './shared-state';

test('deployment requires Redis until the final state backend moves', () => {
  const vars = Object.fromEntries(
    SHARED_STATE_BACKENDS.map(({ flag }) => [flag, 'cloudflare'])
  );
  expect(() => validateSharedStateDeployment(vars, {})).not.toThrow();
  for (const { flag } of SHARED_STATE_BACKENDS) {
    expect(() =>
      validateSharedStateDeployment({ ...vars, [flag]: 'redis' }, {})
    ).toThrow('REDIS_URL');
    expect(() =>
      validateSharedStateDeployment(
        { ...vars, [flag]: 'redis' },
        { REDIS_URL: 'rediss://localhost:6380' }
      )
    ).not.toThrow();
    expect(() =>
      validateSharedStateDeployment(vars, { [flag]: 'redis' })
    ).toThrow('Wrangler vars');
  }
  expect(() => validateSharedStateDeployment({}, {})).toThrow('REDIS_URL');
});
