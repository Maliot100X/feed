import { describe, expect, test } from 'bun:test';
import {
  resolvePerpTicker,
  resolvePerpTickerFrom,
} from '../utils/resolvePerpTicker';

type Org = Parameters<typeof resolvePerpTickerFrom>[1][number];

const org = (id: string, name: string, ticker: string): Org => ({
  id,
  name,
  ticker,
  description: '',
  type: 'company',
  canBeInvolved: true,
  initialPrice: 100,
});

describe('resolvePerpTicker', () => {
  test('matches canonical ticker regardless of casing', () => {
    const result = resolvePerpTicker('tslai');
    expect(result).not.toBeNull();
    expect(result?.ticker).toBe('TSLAI');
  });

  test('matches by organization id', () => {
    const result = resolvePerpTicker('teslai');
    expect(result?.ticker).toBe('TSLAI');
  });

  test('matches by parody name', () => {
    const result = resolvePerpTicker('TeslAI');
    expect(result?.ticker).toBe('TSLAI');
  });

  test('matches by original name', () => {
    const result = resolvePerpTicker('Tesla');
    expect(result?.ticker).toBe('TSLAI');
  });

  test('handles empty-like inputs gracefully', () => {
    expect(resolvePerpTicker('')).toBeNull();
    expect(resolvePerpTicker('   ')).toBeNull();
    expect(resolvePerpTicker(undefined)).toBeNull();
    expect(resolvePerpTicker(null)).toBeNull();
  });

  test('handles special characters in identifier', () => {
    const result = resolvePerpTicker('$TSLAI!!');
    expect(result?.ticker).toBe('TSLAI');
  });

  test('supports prefix partial matches but avoids mid-string matches', () => {
    expect(resolvePerpTicker('tes')).not.toBeNull();
    expect(resolvePerpTicker('tes')?.ticker).toBe('TSLAI');
    expect(resolvePerpTicker('sla')).toBeNull();
  });

  test('returns null for unknown identifiers', () => {
    expect(resolvePerpTicker('not-real')).toBeNull();
  });

  test('punctuation-only identifiers never match a market', () => {
    const orgs = [org('alpha', 'Alpha', 'ALP')];
    expect(resolvePerpTickerFrom('$$$', orgs)).toBeNull();
    expect(resolvePerpTickerFrom('!!', orgs)).toBeNull();
    expect(resolvePerpTicker('---')).toBeNull();
  });

  test('ambiguous prefix returns null instead of the first market', () => {
    const orgs = [
      org('metaverse', 'Metaverse', 'MVRS'),
      org('metallica', 'Metallica', 'MTLC'),
    ];
    expect(resolvePerpTickerFrom('meta', orgs)).toBeNull();
    expect(resolvePerpTickerFrom('metaverse stock', orgs)?.ticker).toBe('MVRS');
  });

  test('unknown name is not resolved', () => {
    const orgs = [org('alpha', 'Alpha', 'ALP')];
    expect(resolvePerpTickerFrom('zzzz', orgs)).toBeNull();
  });
});
