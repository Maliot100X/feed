/**
 * In-memory rate limit cleanup keeps hour-long windows.
 */

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  checkRateLimitAsync,
  cleanupMemoryRateLimits,
  clearAllRateLimits,
  RATE_LIMIT_CONFIGS,
} from '../../api/src/rate-limiting/user-rate-limiter';

describe('user rate limiter (memory fallback)', () => {
  afterEach(async () => {
    mock.restore();
    await clearAllRateLimits();
  });

  it('keeps an hour-long quota through a cleanup at minute six and frees it after the hour', async () => {
    const clock = spyOn(Date, 'now');
    const start = 1_800_000_000_000;
    clock.mockReturnValue(start);
    const config = RATE_LIMIT_CONFIGS.ONCHAIN_REGISTRATION;
    for (let i = 0; i < config.maxRequests; i++) {
      expect((await checkRateLimitAsync('user-1', config)).allowed).toBe(true);
    }

    clock.mockReturnValue(start + 6 * 60 * 1000);
    cleanupMemoryRateLimits();
    expect((await checkRateLimitAsync('user-1', config)).allowed).toBe(false);

    clock.mockReturnValue(start + 61 * 60 * 1000);
    cleanupMemoryRateLimits();
    expect((await checkRateLimitAsync('user-1', config)).allowed).toBe(true);
  });
});
