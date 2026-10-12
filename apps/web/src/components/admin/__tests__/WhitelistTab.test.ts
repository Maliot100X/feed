import { describe, expect, it } from 'bun:test';
import { parseRankThreshold } from '../WhitelistTab';

describe('parseRankThreshold', () => {
  it('accepts plain positive integers', () => {
    expect(parseRankThreshold('1')).toBe(1);
    expect(parseRankThreshold(' 250 ')).toBe(250);
  });

  it('rejects blank input instead of defaulting', () => {
    expect(parseRankThreshold('')).toBeNull();
    expect(parseRankThreshold('   ')).toBeNull();
  });

  it('rejects fractions, exponents, signs and zero', () => {
    for (const input of ['1.5', '1e3', '-5', '+5', '0', '12abc', '0x10']) {
      expect(parseRankThreshold(input)).toBeNull();
    }
  });

  it('rejects values beyond the safe integer range', () => {
    expect(parseRankThreshold('9007199254740993')).toBeNull();
  });
});
