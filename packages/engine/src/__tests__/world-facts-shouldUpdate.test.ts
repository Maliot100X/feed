/**
 * World facts scheduling helpers
 *
 * Exercises the canonical pure helpers used by game-tick (no copied logic).
 * Marker insertion and lock ownership through the real update path are
 * covered in world-facts-update.test.ts.
 */

import { describe, expect, test } from 'bun:test';

import {
  computeLockRenewalIntervalMs,
  GENERATION_MARKER,
  isWorldFactsUpdateDue,
} from '../game-tick';

const HOUR = 60 * 60 * 1000;

describe('isWorldFactsUpdateDue', () => {
  const now = new Date('2024-01-15T12:00:00Z').getTime();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR);

  test('due when no auto-generated fact exists', () => {
    expect(isWorldFactsUpdateDue(null, now, 8 * HOUR)).toBe(true);
  });

  test.each([
    [9, 8, true],
    [5, 8, false],
    [8, 8, true], // exact boundary is due
    [8 - 1 / 60, 8, false], // one minute before boundary
    [2, 1, true],
    [23, 24, false],
    [0.5, 0.5, true],
    [0, 8, false], // just created
    [-1, 8, false], // future timestamp (clock skew) is not due
  ])('%p h ago with %p h interval -> %p', (hoursAgo, intervalHours, due) => {
    expect(isWorldFactsUpdateDue(at(hoursAgo), now, intervalHours * HOUR)).toBe(
      due
    );
  });
});

describe('computeLockRenewalIntervalMs', () => {
  test.each([
    [30 * 60 * 1000, 15 * 60 * 1000],
    [10 * 60 * 1000, 5 * 60 * 1000],
    [60 * 1000, 30 * 1000],
    [10, 5],
    [3, 1],
    [2, 1],
  ])('lock %p ms renews every %p ms', (lockMs, renewalMs) => {
    const renewal = computeLockRenewalIntervalMs(lockMs);
    expect(renewal).toBe(renewalMs);
    expect(renewal).toBeLessThan(lockMs);
    expect(renewal).toBeGreaterThan(0);
  });

  test('rejects durations that cannot renew before expiry', () => {
    for (const bad of [1, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeLockRenewalIntervalMs(bad)).toThrow(RangeError);
    }
  });
});

describe('GENERATION_MARKER contract', () => {
  test('marker is an inactive, low-priority auto-generated system row', () => {
    expect(GENERATION_MARKER).toEqual({
      CATEGORY: 'system',
      KEY: 'generation-marker',
      LABEL: 'World Facts Generation Marker',
      SOURCE: 'auto-generated',
      IS_ACTIVE: false,
      PRIORITY: -1,
    });
  });
});
