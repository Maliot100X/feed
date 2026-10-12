/**
 * Simulation price helper tests (config/simulation.ts).
 */
import { describe, expect, test } from 'bun:test';
import {
  getSimulationPrice,
  getSimulationTickers,
  SIMULATION_DEFAULT_PRICES,
} from '../config/simulation';

describe('getSimulationPrice', () => {
  test('returns the configured default price for known tickers', () => {
    expect(getSimulationPrice('BTCAI')).toBe(SIMULATION_DEFAULT_PRICES.BTCAI);
    expect(getSimulationPrice('ETHAI')).toBe(SIMULATION_DEFAULT_PRICES.ETHAI);
  });

  test('overrides take precedence over defaults; missing overrides fall back to defaults', () => {
    const overrides = new Map([
      ['BTCAI', 150000],
      ['NEWTOKEN', 999],
    ]);

    expect(getSimulationPrice('BTCAI', overrides)).toBe(150000);
    expect(getSimulationPrice('NEWTOKEN', overrides)).toBe(999);
    expect(getSimulationPrice('SOLAI', overrides)).toBe(
      SIMULATION_DEFAULT_PRICES.SOLAI
    );
  });

  test('preserves override precision', () => {
    const overrides = new Map([
      ['BTCAI', 125432.789123],
      ['METAI', 0.00001234],
    ]);
    expect(getSimulationPrice('BTCAI', overrides)).toBe(125432.789123);
    expect(getSimulationPrice('METAI', overrides)).toBe(0.00001234);
  });
});

describe('getSimulationTickers', () => {
  test('returns default tickers when overrides are absent or empty', () => {
    const defaults = Object.keys(SIMULATION_DEFAULT_PRICES);
    expect(getSimulationTickers()).toEqual(defaults);
    expect(getSimulationTickers(new Map())).toEqual(defaults);
  });

  test('returns only override tickers when overrides are non-empty', () => {
    const overrides = new Map([
      ['CUSTOMTOKEN', 500],
      ['BTCAI', 125000],
    ]);
    expect(getSimulationTickers(overrides)).toEqual(['CUSTOMTOKEN', 'BTCAI']);
  });
});
