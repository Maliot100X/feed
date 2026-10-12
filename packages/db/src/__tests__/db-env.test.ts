import { afterEach, describe, expect, it } from 'bun:test';
import { parsePositiveIntEnv } from '../db';

const KEY = 'DATABASE_STATEMENT_TIMEOUT_MS';
const previous = process.env[KEY];

describe('parsePositiveIntEnv', () => {
  afterEach(() => {
    if (previous === undefined) delete process.env[KEY];
    else process.env[KEY] = previous;
  });

  it('does not cap timeouts at the pool-size cap', () => {
    process.env[KEY] = '60000';
    expect(parsePositiveIntEnv(KEY)).toBe(60000);
  });

  it('rejects trailing junk and non-integers instead of partially parsing', () => {
    for (const raw of ['60s', '1e3', '12.5', '-5', '0', 'abc']) {
      process.env[KEY] = raw;
      expect(parsePositiveIntEnv(KEY)).toBeUndefined();
    }
  });
});
