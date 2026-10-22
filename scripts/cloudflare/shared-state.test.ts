import { expect, test } from 'bun:test';
import { SHARED_STATE_BACKENDS } from '../../packages/api/src/redis/shared-state-health';
import {
  validateSharedStateDeployment,
  verifySharedStateDeployment,
} from './shared-state';

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

test('deployment verification rejects missing, stale or unhealthy storage probes and pause drift', () => {
  const vars = Object.fromEntries(
    SHARED_STATE_BACKENDS.map(({ flag }) => [flag, 'cloudflare'])
  );
  const body = {
    healthy: true,
    paused: true,
    backends: SHARED_STATE_BACKENDS.map(({ binding }) => ({
      name: binding,
      provider: 'cloudflare',
      healthy: true,
    })),
  };
  expect(() => verifySharedStateDeployment(body, vars, true)).not.toThrow();
  expect(() =>
    verifySharedStateDeployment({ ...body, paused: false }, vars, true)
  ).toThrow();
  expect(() =>
    verifySharedStateDeployment(
      { ...body, backends: body.backends.slice(1) },
      vars,
      true
    )
  ).toThrow();
  expect(() =>
    verifySharedStateDeployment(
      { ...body, backends: [...body.backends, body.backends[0]] },
      vars,
      true
    )
  ).toThrow();
  expect(() =>
    verifySharedStateDeployment(
      {
        ...body,
        backends: [{ name: 'redis', provider: 'redis', healthy: true }],
      },
      vars,
      true
    )
  ).toThrow();
  expect(() =>
    verifySharedStateDeployment({ ...body, healthy: false }, vars, true)
  ).toThrow();
  expect(() =>
    verifySharedStateDeployment(
      {
        ...body,
        backends: body.backends.map((b) => ({ ...b, healthy: false })),
      },
      vars,
      true
    )
  ).toThrow();
  expect(() =>
    verifySharedStateDeployment(
      {
        healthy: true,
        paused: false,
        backends: [{ name: 'redis', provider: 'redis', healthy: true }],
      },
      {},
      false
    )
  ).not.toThrow();
});
