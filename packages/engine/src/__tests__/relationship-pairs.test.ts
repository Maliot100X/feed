import { describe, expect, it } from 'bun:test';
import {
  canonicalActorPair,
  groupInteractionsByPair,
} from '../RelationshipEvolutionEngine';

describe('relationship pair keys', () => {
  it('orders a pair canonically regardless of input order', () => {
    expect(canonicalActorPair('b', 'a')).toEqual(['a', 'b']);
    expect(canonicalActorPair('a', 'b')).toEqual(['a', 'b']);
  });

  it('groups reversed interactions into one pair', () => {
    const pairs = groupInteractionsByPair([
      { actor1Id: 'x', actor2Id: 'y' },
      { actor1Id: 'y', actor2Id: 'x' },
    ]);
    expect(pairs.size).toBe(1);
    const [pair] = [...pairs.values()];
    expect(pair).toMatchObject({ actor1Id: 'x', actor2Id: 'y' });
    expect(pair?.interactions).toHaveLength(2);
  });

  it('keeps underscore-containing IDs intact and distinct', () => {
    // With an `${a}_${b}` key these two pairs collide and split wrongly
    const pairs = groupInteractionsByPair([
      { actor1Id: 'a_b', actor2Id: 'c' },
      { actor1Id: 'a', actor2Id: 'b_c' },
    ]);
    expect(pairs.size).toBe(2);
    expect([...pairs.values()].map((p) => [p.actor1Id, p.actor2Id])).toEqual([
      ['a_b', 'c'],
      ['a', 'b_c'],
    ]);
  });
});
