import { describe, expect, test } from 'bun:test';
import { GameClock } from '../../GameClock';

describe('GameClock', () => {
  test('defaults day 1 to the historical start time', () => {
    const start = new Date('2020-01-01T00:00:00.000Z');
    const clock = new GameClock({ mode: 'simulated', startTime: start });
    expect(clock.now().day).toBe(1);
    clock.advanceHours(25);
    expect(clock.now().day).toBe(2);
    expect(clock.now().hour).toBe(1);
  });

  test('mutating returned or supplied dates does not move the clock', () => {
    const start = new Date('2020-01-01T00:00:00.000Z');
    const clock = GameClock.simulated(start, start);
    start.setUTCFullYear(1999);
    const t = clock.now().timestamp;
    t.setUTCFullYear(1990);
    expect(clock.now().timestamp.toISOString()).toBe(
      '2020-01-01T00:00:00.000Z'
    );

    const target = new Date('2020-01-02T00:00:00.000Z');
    clock.setTime(target);
    target.setUTCFullYear(1980);
    expect(clock.now().timestamp.toISOString()).toBe(
      '2020-01-02T00:00:00.000Z'
    );
  });

  test('rejects fractional, negative and non-finite advances', () => {
    const clock = GameClock.simulated(new Date('2020-01-01T00:00:00.000Z'));
    expect(() => clock.advanceHours(0.5)).toThrow();
    expect(() => clock.advanceHours(-1)).toThrow();
    expect(() => clock.advanceHours(Number.NaN)).toThrow();
    expect(() => clock.advanceHours(Number.POSITIVE_INFINITY)).toThrow();
    expect(clock.getCurrentTick()).toBe(0);
  });

  test('rejects invalid dates', () => {
    expect(
      () => new GameClock({ mode: 'simulated', startTime: new Date('nope') })
    ).toThrow();
    const clock = GameClock.simulated(new Date('2020-01-01T00:00:00.000Z'));
    expect(() => clock.setTime(new Date(Number.NaN))).toThrow();
  });
});
