import { describe, expect, test } from 'bun:test';
import { PredictionPricing } from '@feed/core/markets/prediction/client';
import {
  calculateProbabilityVolatility,
  calculateReturnVolatility,
  formatLeadingOutcome,
} from '../services/market-metrics-service';

describe('market metrics helpers', () => {
  test('CPMM YES probability is the NO reserve share (asymmetric reserves)', () => {
    // More YES shares in the pool means YES is cheap.
    expect(PredictionPricing.getCurrentPrice(900, 100, 'yes')).toBeCloseTo(0.1);
  });

  test('formatLeadingOutcome labels the leading side with its own probability', () => {
    expect(formatLeadingOutcome(0.05)).toBe('95% NO');
    expect(formatLeadingOutcome(0.95)).toBe('95% YES');
    expect(formatLeadingOutcome(0.5)).toBe('50% YES');
  });

  test('return volatility is scale-invariant across price levels', () => {
    const base = [100, 102, 99, 103, 101];
    const scaled = base.map((p) => p * 1000);
    expect(calculateReturnVolatility(scaled)).toBeCloseTo(
      calculateReturnVolatility(base)
    );
    // A ~2% wiggle on a $100k stock must not saturate the score.
    expect(calculateReturnVolatility(scaled)).toBeLessThan(0.5);
  });

  test('return volatility ignores invalid prices and needs two returns', () => {
    expect(calculateReturnVolatility([100, 101])).toBe(0);
    expect(calculateReturnVolatility([100, 0, Number.NaN, 101])).toBe(0);
  });

  test('probability volatility saturates at 1 and is 0 for short series', () => {
    expect(calculateProbabilityVolatility([0.5])).toBe(0);
    expect(calculateProbabilityVolatility([0, 1, 0, 1])).toBe(1);
  });
});
