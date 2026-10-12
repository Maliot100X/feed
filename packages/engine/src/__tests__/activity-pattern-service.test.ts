/**
 * Activity Pattern Service Tests
 *
 * Each actor is active for ACTIVE_HOURS_PER_DAY consecutive UTC hours,
 * rotating based on ID hash + game day.
 */

import { describe, expect, test } from 'bun:test';
import {
  ACTIVE_HOURS_PER_DAY,
  getActorActiveHours,
  isActiveHour,
} from '../services/activity-pattern-service';

describe('getActorActiveHours', () => {
  test('returns ACTIVE_HOURS_PER_DAY consecutive hours (wrapping midnight)', () => {
    const hours = getActorActiveHours('test-actor-xyz');
    expect(hours.length).toBe(ACTIVE_HOURS_PER_DAY);
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i]).toBe((hours[i - 1]! + 1) % 24);
    }
  });

  test('is deterministic per actor/day and rotates by game day', () => {
    expect(getActorActiveHours('a-1', 1)).toEqual(
      getActorActiveHours('a-1', 1)
    );
    expect(getActorActiveHours('a-1', 2)[0]).toBe(
      (getActorActiveHours('a-1', 1)[0]! + 1) % 24
    );
  });

  test('different actor IDs spread across start hours', () => {
    const starts = new Set(
      Array.from({ length: 50 }, (_, i) => getActorActiveHours(`actor-${i}`)[0])
    );
    expect(starts.size).toBeGreaterThan(1);
  });

  test('rejects invalid game days', () => {
    for (const day of [0, -1, 1.5, Number.NaN]) {
      expect(() => getActorActiveHours('a', day)).toThrow(TypeError);
    }
  });
});

describe('isActiveHour', () => {
  test('matches the active hour window exactly', () => {
    const hours = new Set(getActorActiveHours('test-actor-1', 3));
    for (let h = 0; h < 24; h++) {
      expect(isActiveHour({ id: 'test-actor-1' }, h, 3)).toBe(hours.has(h));
    }
  });

  test('rejects invalid hours instead of silently returning inactive', () => {
    for (const hour of [-1, 24, 1.5, Number.NaN]) {
      expect(() => isActiveHour({ id: 'a' }, hour)).toThrow(TypeError);
    }
  });
});
