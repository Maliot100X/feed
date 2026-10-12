import { describe, expect, test } from 'bun:test';
import { NPCGroupDynamicsCalculations } from '../../services/npc-group-dynamics-calculations';

describe('NPCGroupDynamicsCalculations input validation', () => {
  test('rejects negative, fractional and non-finite counts', () => {
    const calc = NPCGroupDynamicsCalculations.calculateKickProbability;
    expect(() => calc(1, -1, 5)).toThrow();
    expect(() => calc(1, 10.5, 5)).toThrow();
    expect(() => calc(1, Number.NaN, 5)).toThrow();
    expect(() => calc(1, 10, -2)).toThrow();
    expect(() => calc(1, 10, 5, 0)).toThrow();
    expect(() => calc(1, 10, 5, Number.POSITIVE_INFINITY)).toThrow();
  });

  test('valid inputs still produce a probability in [0, 1]', () => {
    const result = NPCGroupDynamicsCalculations.calculateKickProbability(
      3,
      30,
      10
    );
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(1);
  });
});
