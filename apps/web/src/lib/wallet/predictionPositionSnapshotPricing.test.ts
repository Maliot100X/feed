import { describe, expect, it } from 'bun:test';
import { calculatePredictionPositionSnapshot } from '@feed/core/markets/prediction';

describe('calculatePredictionPositionSnapshot', () => {
  it('prices a resolved winning position at full payout', () => {
    const snapshot = calculatePredictionPositionSnapshot({
      shares: 12,
      avgPrice: 0.4,
      side: 'yes',
      yesShares: 520,
      noShares: 480,
      feeRate: 0,
      resolved: true,
      resolution: true,
    });

    expect(snapshot.currentProbability).toBe(1);
    expect(snapshot.currentUnitPrice).toBe(1);
    expect(snapshot.currentValue).toBe(12);
    expect(snapshot.unrealizedPnL).toBeCloseTo(7.2, 6);
  });

  it('prices a resolved losing position at zero', () => {
    const snapshot = calculatePredictionPositionSnapshot({
      shares: 8,
      avgPrice: 0.65,
      side: 'no',
      yesShares: 520,
      noShares: 480,
      feeRate: 0,
      resolved: true,
      resolution: true,
    });

    expect(snapshot.currentProbability).toBe(0);
    expect(snapshot.currentUnitPrice).toBe(0);
    expect(snapshot.currentValue).toBe(0);
    expect(snapshot.unrealizedPnL).toBeCloseTo(-5.2, 6);
  });
});
