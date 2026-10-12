import { describe, expect, test } from 'bun:test';
import { requireContextNumber } from '../../agents/src/autonomous/utils/context-validation';

describe('required numeric agent context', () => {
  test('rejects missing and corrupt financial data', () => {
    for (const value of [
      null,
      undefined,
      '',
      ' ',
      'bad',
      NaN,
      Infinity,
      -Infinity,
    ]) {
      expect(() => requireContextNumber(value, 'portfolio balance')).toThrow(
        'portfolio balance'
      );
    }
  });
  test('retains zero balances and negative PnL', () => {
    expect(requireContextNumber('0', 'balance', 0)).toBe(0);
    expect(requireContextNumber('-25.5', 'pnl')).toBe(-25.5);
    expect(() =>
      requireContextNumber(0, 'entryPrice', Number.MIN_VALUE)
    ).toThrow('entryPrice');
  });
});
