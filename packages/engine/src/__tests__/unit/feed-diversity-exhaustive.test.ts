import { describe, expect, test } from 'bun:test';
import {
  ActionDiversityTracker,
  shuffleWithNoConsecutive,
} from '../../utils/feed-diversity';

/** All multisets over {a,b,c} with total size 1..7. */
function smallMultisets(): string[][] {
  const out: string[][] = [];
  for (let a = 0; a <= 7; a++) {
    for (let b = 0; a + b <= 7; b++) {
      for (let c = 0; a + b + c <= 7; c++) {
        if (a + b + c === 0) continue;
        out.push([
          ...Array<string>(a).fill('a'),
          ...Array<string>(b).fill('b'),
          ...Array<string>(c).fill('c'),
        ]);
      }
    }
  }
  return out;
}

const adjacentDuplicates = (xs: string[]) =>
  xs.slice(1).filter((x, i) => x === xs[i]).length;

function arrangementPossible(xs: string[]): boolean {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return Math.max(...counts.values()) <= Math.ceil(xs.length / 2);
}

function rngs(): Array<() => number> {
  return [() => 0, () => 0.999999, () => 0.5].concat(
    [1, 7, 42].map((seed) => {
      let x = seed;
      return () => {
        x = (x * 16807) % 2147483647;
        return x / 2147483647;
      };
    })
  );
}

describe('shuffleWithNoConsecutive (exhaustive small multisets)', () => {
  test('never produces adjacent duplicates when an arrangement exists', () => {
    for (const deck of smallMultisets()) {
      for (const rng of rngs()) {
        const out = shuffleWithNoConsecutive(deck, rng);
        expect([...out].sort()).toEqual([...deck].sort());
        if (arrangementPossible(deck)) {
          expect(adjacentDuplicates(out)).toBe(0);
        }
      }
    }
  });

  test('impossible decks still keep the multiset with minimal adjacency', () => {
    const deck = ['a', 'a', 'a', 'a', 'b'];
    const out = shuffleWithNoConsecutive(deck, () => 0);
    expect([...out].sort()).toEqual([...deck].sort());
    // Best achievable: a b a a a -> 2 adjacent pairs
    expect(adjacentDuplicates(out)).toBe(2);
  });
});

describe('ActionDiversityTracker', () => {
  test('degenerate limits still enforce the effective maxConsecutive', () => {
    const tracker = new ActionDiversityTracker(0, 0);
    tracker.recordAction('like');
    expect(tracker.shouldSkipForDiversity('like')).toBe(true);
    expect(tracker.shouldSkipForDiversity('share')).toBe(false);
  });

  test('rejects non-integer limits', () => {
    expect(() => new ActionDiversityTracker(Number.NaN, 2)).toThrow();
  });
});
