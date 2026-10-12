import { describe, expect, it } from 'bun:test';
import {
  ORG_TYPE_WEIGHTS,
  type OrgType,
  selectWeightedOrganizations,
} from '../select-organizations';

const TYPES = Object.keys(ORG_TYPE_WEIGHTS) as OrgType[];

const ORGS = TYPES.flatMap((type) =>
  [1, 2].map((n) => ({ id: `${type}-${n}`, name: `${type} ${n}`, type }))
);

/** Deterministic RNG that replays a fixed sequence. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => {
    const value = values[i % values.length]!;
    i += 1;
    return value;
  };
}

/** Seeded LCG for reproducible pseudo-random draws. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe('selectWeightedOrganizations', () => {
  it('returns all orgs when fewer than requested', () => {
    expect(selectWeightedOrganizations(ORGS.slice(0, 2), 3)).toHaveLength(2);
  });

  it('can select the lowest-weight type even when higher types are eligible', () => {
    // A draw near 1.0 lands on the last type in insertion order (government).
    const selected = selectWeightedOrganizations(ORGS, 1, sequence([0.999, 0]));
    expect(selected).toHaveLength(1);
    expect(selected[0]?.type).toBe('government');
  });

  it('includes every positive-weight type over many seeded ticks', () => {
    const seen = new Set<string>();
    const random = lcg(42);
    for (let tick = 0; tick < 200; tick++) {
      for (const org of selectWeightedOrganizations(ORGS, 3, random)) {
        seen.add(org.type);
      }
    }
    expect([...seen].sort()).toEqual([...TYPES].sort());
  });

  it('selects distinct orgs with distinct types first', () => {
    const selected = selectWeightedOrganizations(ORGS, 4, lcg(7));
    expect(new Set(selected.map((o) => o.id)).size).toBe(4);
    expect(new Set(selected.map((o) => o.type)).size).toBe(4);
  });

  it('favors higher-weight types in aggregate', () => {
    const counts = new Map<string, number>();
    const random = lcg(1);
    for (let tick = 0; tick < 2000; tick++) {
      for (const org of selectWeightedOrganizations(ORGS, 1, random)) {
        counts.set(org.type, (counts.get(org.type) ?? 0) + 1);
      }
    }
    expect(counts.get('media')!).toBeGreaterThan(counts.get('government')!);
  });
});
