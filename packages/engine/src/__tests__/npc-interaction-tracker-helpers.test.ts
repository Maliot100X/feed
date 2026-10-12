import { describe, expect, test } from 'bun:test';
import {
  normalizeFocusWeights,
  normalizeInteractionWindow,
} from '../services/npc-interaction-tracker';

describe('normalizeInteractionWindow', () => {
  const now = new Date('2026-01-31T00:00:00.000Z');

  test('caps a future end date at now for every query', () => {
    const window = normalizeInteractionWindow(
      {
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-03-01T00:00:00.000Z'),
      },
      now
    );
    expect(window.endDate).toEqual(now);
  });

  test('defaults to 30 days ending now', () => {
    const window = normalizeInteractionWindow(undefined, now);
    expect(window.endDate).toEqual(now);
    expect(now.getTime() - window.startDate.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000
    );
  });

  test('rejects reversed or empty windows', () => {
    expect(() =>
      normalizeInteractionWindow(
        {
          startDate: new Date('2026-01-20T00:00:00.000Z'),
          endDate: new Date('2026-01-10T00:00:00.000Z'),
        },
        now
      )
    ).toThrow('Invalid interaction window');
    expect(() =>
      normalizeInteractionWindow(
        { startDate: new Date('2026-02-15T00:00:00.000Z') },
        now
      )
    ).toThrow('Invalid interaction window');
  });
});

describe('normalizeFocusWeights', () => {
  test('ignores custom trading weight when trading activity is disabled', () => {
    expect(normalizeFocusWeights({ social: 0.5, trading: 0.5 }, false)).toEqual(
      { social: 1, trading: 0 }
    );
  });

  test('normalizes enabled weights to sum to 1', () => {
    expect(normalizeFocusWeights({ social: 3, trading: 1 }, true)).toEqual({
      social: 0.75,
      trading: 0.25,
    });
  });

  test('rejects invalid or all-zero weights', () => {
    expect(() =>
      normalizeFocusWeights({ social: -1, trading: 1 }, true)
    ).toThrow();
    expect(() =>
      normalizeFocusWeights({ social: Number.NaN, trading: 1 }, true)
    ).toThrow();
    expect(() =>
      normalizeFocusWeights({ social: 0, trading: 0 }, true)
    ).toThrow('must not all be zero');
    expect(() =>
      normalizeFocusWeights({ social: 0, trading: 1 }, false)
    ).toThrow('must not all be zero');
  });
});
