import { describe, expect, it } from 'bun:test';
import { getAnalyticsBuckets } from '../_buckets';

describe('getAnalyticsBuckets', () => {
  it('month: six whole UTC months on Jan 31 (no short-month overflow)', () => {
    const { start, end, keys } = getAnalyticsBuckets(
      'month',
      new Date('2026-01-31T15:00:00Z')
    );
    expect(keys).toEqual([
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
    expect(start.toISOString()).toBe('2025-08-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('month: includes current month on Mar 31 including Feb', () => {
    const { keys } = getAnalyticsBuckets(
      'month',
      new Date('2028-03-31T23:59:59Z')
    );
    expect(keys).toEqual([
      '2027-10',
      '2027-11',
      '2027-12',
      '2028-01',
      '2028-02',
      '2028-03',
    ]);
  });

  it('day: seven UTC days ending today, half-open end at next midnight', () => {
    const { start, end, keys } = getAnalyticsBuckets(
      'day',
      new Date('2024-03-01T00:00:00Z')
    );
    expect(keys).toEqual([
      '2024-02-24',
      '2024-02-25',
      '2024-02-26',
      '2024-02-27',
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
    expect(start.toISOString()).toBe('2024-02-24T00:00:00.000Z');
    expect(end.toISOString()).toBe('2024-03-02T00:00:00.000Z');
  });

  it('week: 28 consecutive daily buckets', () => {
    const { keys } = getAnalyticsBuckets(
      'week',
      new Date('2026-10-11T12:00:00Z')
    );
    expect(keys).toHaveLength(28);
    expect(keys[0]).toBe('2026-09-14');
    expect(keys[27]).toBe('2026-10-11');
    expect(new Set(keys).size).toBe(28);
  });
});
