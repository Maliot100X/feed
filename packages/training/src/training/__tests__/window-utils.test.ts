import { describe, expect, test } from 'bun:test';
import { splitIntoBatches } from '../../utils';
import {
  generateWindowIds,
  getPreviousWindowId,
  getWindowIdForTimestamp,
  getWindowRange,
  parseWindowId,
} from '../window-utils';

describe('window-utils', () => {
  test('parseWindowId treats IDs as UTC regardless of host time zone', () => {
    expect(parseWindowId('2025-01-15T10:00').toISOString()).toBe(
      '2025-01-15T10:00:00.000Z'
    );
  });

  test('parseWindowId rejects malformed IDs', () => {
    expect(() => parseWindowId('2025-01-15')).toThrow();
    expect(() => parseWindowId('not-a-window')).toThrow();
  });

  test('window IDs round-trip through parse and format', () => {
    const id = getWindowIdForTimestamp(new Date('2025-03-30T01:42:00Z'));
    expect(id).toBe('2025-03-30T01:00');
    expect(getWindowIdForTimestamp(parseWindowId(id))).toBe(id);
    expect(getWindowRange(id, 2).end.toISOString()).toBe(
      '2025-03-30T03:00:00.000Z'
    );
  });

  test('getPreviousWindowId steps back whole UTC hours', () => {
    const current = parseWindowId(getPreviousWindowId(0)).getTime();
    const previous = parseWindowId(getPreviousWindowId(5)).getTime();
    expect(current - previous).toBe(5 * 60 * 60 * 1000);
  });

  test('generateWindowIds rejects non-positive durations', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T03:00:00Z');
    expect(generateWindowIds(start, end)).toEqual([
      '2025-01-01T00:00',
      '2025-01-01T01:00',
      '2025-01-01T02:00',
      '2025-01-01T03:00',
    ]);
    expect(() => generateWindowIds(start, end, 0)).toThrow();
    expect(() => generateWindowIds(start, end, -1)).toThrow();
  });
});

describe('splitIntoBatches', () => {
  test('splits into fixed-size batches', () => {
    expect(splitIntoBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test('rejects sizes that would never advance', () => {
    expect(() => splitIntoBatches([1], 0)).toThrow();
    expect(() => splitIntoBatches([1], -2)).toThrow();
    expect(() => splitIntoBatches([1], 1.5)).toThrow();
  });
});
