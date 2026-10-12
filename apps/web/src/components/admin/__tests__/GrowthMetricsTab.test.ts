import { describe, expect, it } from 'bun:test';
import { buildFunnelStages } from '../GrowthMetricsTab';

describe('buildFunnelStages', () => {
  it('computes percentages relative to signups', () => {
    const stages = buildFunnelStages({
      signups: 200,
      tradedWithin24h: 50,
      commandedWithin24h: 20,
      activated: 60,
    });
    expect(stages.map((s) => s.pct)).toEqual([100, 25, 10, 30]);
    expect(stages.map((s) => s.value)).toEqual([200, 50, 20, 60]);
  });

  it('does not show a full signup bar or fabricated widths with zero signups', () => {
    const stages = buildFunnelStages({
      signups: 0,
      tradedWithin24h: 0,
      commandedWithin24h: 0,
      activated: 0,
    });
    expect(stages.every((s) => s.pct === 0)).toBe(true);
  });
});
