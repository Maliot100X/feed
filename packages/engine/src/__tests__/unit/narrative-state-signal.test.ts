import { describe, expect, test } from 'bun:test';
import {
  type DatabaseArcPlan,
  getSignalDirection,
  phaseSignalRatio,
} from '../../services/narrative-state-service';

function makePlan(
  phaseRatios: Partial<DatabaseArcPlan['phaseRatios']>
): DatabaseArcPlan {
  return {
    id: 'plan-1',
    questionId: 'q-1',
    insiderActorIds: ['insider'],
    deceiverActorIds: ['deceiver'],
    phaseRatios,
  } as DatabaseArcPlan;
}

describe('phaseSignalRatio', () => {
  test('computes correct / total', () => {
    expect(phaseSignalRatio(3, 1)).toBe(0.75);
    expect(phaseSignalRatio(3, 0)).toBe(1);
  });

  test('rejects zero-total and invalid targets instead of producing NaN', () => {
    expect(() => phaseSignalRatio(0, 0)).toThrow();
    expect(() => phaseSignalRatio(-1, 2)).toThrow();
    expect(() => phaseSignalRatio(Number.NaN, 2)).toThrow();
  });
});

describe('getSignalDirection', () => {
  const full = { early: 0.5, middle: 0.5, late: 0.5, climax: 1 };

  test('insiders point toward truth, deceivers away', () => {
    const plan = makePlan(full);
    expect(getSignalDirection(plan, 'early', 'insider', false).direction).toBe(
      'NO'
    );
    expect(getSignalDirection(plan, 'early', 'deceiver', false).direction).toBe(
      'YES'
    );
  });

  test('uses stored phase ratio with injected rng', () => {
    const plan = makePlan(full);
    expect(
      getSignalDirection(plan, 'early', '', true, () => 0.1).direction
    ).toBe('YES');
    expect(
      getSignalDirection(plan, 'early', '', true, () => 0.9).direction
    ).toBe('NO');
  });

  test('throws on a missing or invalid phase ratio', () => {
    expect(() =>
      getSignalDirection(makePlan({ early: 0.5 }), 'late', '', true, () => 0)
    ).toThrow('invalid phase ratio');
    expect(() =>
      getSignalDirection(
        makePlan({ ...full, middle: Number.NaN }),
        'middle',
        '',
        true,
        () => 0
      )
    ).toThrow('invalid phase ratio');
  });
});
