import { describe, expect, test } from 'bun:test';
import {
  calculateConfidenceScore,
  getTrustLevel,
  normalizePnL,
} from '../../reputation/pnl-normalizer';

describe('pnl-normalizer', () => {
  test('sigmoid values match documented examples', () => {
    expect(normalizePnL(0, 100)).toBe(0.5);
    expect(normalizePnL(100, 100)).toBeCloseTo(0.731, 3);
    expect(normalizePnL(-50, 100)).toBeCloseTo(0.378, 3);
    expect(normalizePnL(200, 100)).toBeCloseTo(0.881, 3);
  });

  test('non-finite inputs throw instead of producing NaN scores', () => {
    expect(() => normalizePnL(Number.NaN, 100)).toThrow();
    expect(() => normalizePnL(10, Number.POSITIVE_INFINITY)).toThrow();
  });

  test('NaN reputation never becomes EXCELLENT', () => {
    expect(getTrustLevel(Number.NaN)).toBe('UNRATED');
    expect(getTrustLevel(85)).toBe('EXCELLENT');
  });

  test('confidence is zero for empty or invalid samples', () => {
    expect(calculateConfidenceScore(0)).toBe(0);
    expect(calculateConfidenceScore(-3)).toBe(0);
    expect(calculateConfidenceScore(Number.NaN)).toBe(0);
    expect(calculateConfidenceScore(14)).toBeCloseTo(0.503, 3);
  });
});
