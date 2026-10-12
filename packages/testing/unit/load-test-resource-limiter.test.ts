/**
 * The load-test resource limiter must keep blocking admission after an
 * emergency stop until it is explicitly restarted.
 */

import { describe, expect, it } from 'bun:test';
import { ResourceLimiter } from '../load-test/resource-limiter';

describe('ResourceLimiter', () => {
  it('stays stopped after an emergency stop until restarted', async () => {
    const limiter = new ResourceLimiter({
      maxMemoryMB: 1,
      checkIntervalMs: 5,
    });
    let stopCalls = 0;
    limiter.start(() => {
      stopCalls++;
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(stopCalls).toBe(1);
    expect(limiter.isStopped()).toBe(true);
    expect(limiter.canMakeRequest()).toBe(false);

    limiter.start();
    expect(limiter.isStopped()).toBe(false);
    limiter.stop();
    expect(limiter.isStopped()).toBe(false);
  });
});
