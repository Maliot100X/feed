/**
 * NPC duplicate position prevention (production allocation planner).
 */

import { describe, expect, it } from 'bun:test';
import { planBaselinePerpAllocations } from '../../npc/npc-investment-manager';

describe('planBaselinePerpAllocations', () => {
  const targets = [
    { orgId: 'teslai', ticker: 'TSLAI' },
    { orgId: 'openagi', ticker: 'OPENAGI' },
    { orgId: 'aipple', ticker: 'AAPL' },
  ];

  it('skips organizations with an open position keyed by organization id', () => {
    const plan = planBaselinePerpAllocations(
      'npc-1',
      targets,
      90,
      new Set(['npc-1:teslai'])
    );
    expect(plan.map((p) => p.ticker)).toEqual(['OPENAGI', 'AAPL']);
  });

  it('matches existing keys case-insensitively and per actor', () => {
    const plan = planBaselinePerpAllocations(
      'npc-1',
      [{ orgId: 'AiPPLE', ticker: 'AAPL' }],
      10,
      new Set(['npc-2:aipple', 'npc-1:aipple'])
    );
    expect(plan).toEqual([]);
  });

  it('spends the whole budget across the targets that remain', () => {
    const plan = planBaselinePerpAllocations(
      'npc-1',
      targets,
      90,
      new Set(['npc-1:openagi'])
    );
    expect(plan).toEqual([
      { ticker: 'TSLAI', amount: 45 },
      { ticker: 'AAPL', amount: 45 },
    ]);
  });

  it('returns nothing when every target is already held', () => {
    expect(
      planBaselinePerpAllocations(
        'npc-1',
        targets,
        90,
        new Set(['npc-1:teslai', 'npc-1:openagi', 'npc-1:aipple'])
      )
    ).toEqual([]);
  });
});
