/**
 * Boundary regression tests for engine utility contracts (random, index,
 * truncation helpers).
 */

import { describe, expect, test } from 'bun:test';
import {
  countTokensSync,
  truncateToTokenLimitSync,
} from '../../llm/token-counter';
import { at, atOrThrow } from '../../utils/array-utils';
import { truncateArray, truncateText } from '../../utils/context-limits';
import { SeededRandom } from '../../utils/entropy';
import { sampleRandom } from '../../utils/randomization';

describe('SeededRandom', () => {
  test('next() stays strictly below 1 for many draws', () => {
    for (const seed of [0, 1, 42, 12345, 0xffffffff, 'seed']) {
      const rng = new SeededRandom(seed);
      for (let i = 0; i < 10_000; i++) {
        const v = rng.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  test('pick() never returns an out-of-range element', () => {
    const rng = new SeededRandom(7);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 5_000; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  test('pick() on an empty array throws instead of returning undefined', () => {
    expect(() => new SeededRandom(1).pick([])).toThrow('empty');
  });

  test('anagram string seeds produce different streams', () => {
    const a = new SeededRandom('abc');
    const b = new SeededRandom('cba');
    expect(a.next()).not.toBe(b.next());
  });

  test('string seeds are reproducible', () => {
    const a = new SeededRandom('test-seed');
    const b = new SeededRandom('test-seed');
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});

describe('sampleRandom', () => {
  test('negative, zero and NaN counts return an empty array', () => {
    expect(sampleRandom([1, 2, 3], -1)).toEqual([]);
    expect(sampleRandom([1, 2, 3], 0)).toEqual([]);
    expect(sampleRandom([1, 2, 3], Number.NaN)).toEqual([]);
  });

  test('count larger than array returns every element once', () => {
    expect(sampleRandom([1, 2, 3], 10).sort()).toEqual([1, 2, 3]);
    expect(sampleRandom([1, 2, 3], Number.POSITIVE_INFINITY).sort()).toEqual([
      1, 2, 3,
    ]);
  });
});

describe('array index helpers', () => {
  test('at() rejects fractional and NaN indices', () => {
    expect(at([1, 2, 3], 1.5)).toBeUndefined();
    expect(at([1, 2, 3], Number.NaN)).toBeUndefined();
  });

  test('atOrThrow() rejects fractional and NaN indices', () => {
    expect(() => atOrThrow([1, 2, 3], 0.5)).toThrow();
    expect(() => atOrThrow([1, 2, 3], Number.NaN)).toThrow();
    expect(atOrThrow([1, 2, 3], -1)).toBe(3);
  });
});

describe('context-limits truncation', () => {
  test('truncateText never exceeds the budget', () => {
    for (const max of [0, 1, 2, 3, 4, 10]) {
      expect(truncateText('abcdefghijklmnop', max).length).toBeLessThanOrEqual(
        max
      );
    }
    expect(truncateText('abcdefghijklmnop', -5)).toBe('');
    expect(truncateText('abcdefghij', 6)).toBe('abc...');
  });

  test('truncateArray with negative limit returns empty', () => {
    expect(truncateArray([1, 2, 3], -1)).toEqual([]);
    expect(truncateArray([1, 2, 3], 2)).toEqual([1, 2]);
  });
});

describe('truncateToTokenLimitSync', () => {
  const long = 'x'.repeat(400); // 100 tokens

  test('zero and negative budgets return empty text', () => {
    expect(truncateToTokenLimitSync(long, 0)).toEqual({ text: '', tokens: 0 });
    expect(truncateToTokenLimitSync(long, -10)).toEqual({
      text: '',
      tokens: 0,
    });
    expect(
      truncateToTokenLimitSync(long, -10, { preserveEnd: true }).text
    ).toBe('');
  });

  test('budget of one token does not return oversized output', () => {
    const r = truncateToTokenLimitSync(long, 1);
    expect(countTokensSync(r.text)).toBeLessThanOrEqual(1);
  });

  test('NaN budget throws', () => {
    expect(() => truncateToTokenLimitSync(long, Number.NaN)).toThrow();
  });

  test('positive budgets stay within limit', () => {
    for (const max of [2, 5, 50]) {
      const r = truncateToTokenLimitSync(long, max);
      expect(r.tokens).toBeLessThanOrEqual(max);
      expect(r.text.endsWith('...')).toBe(true);
    }
    expect(truncateToTokenLimitSync(long, Number.POSITIVE_INFINITY).text).toBe(
      long
    );
  });
});
