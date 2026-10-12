import { describe, expect, test } from 'bun:test';
import { InMemoryStateStore } from '../adapters/InMemoryStateStore';

function firstMarket(store: InMemoryStateStore) {
  const market = store.getState().predictionMarkets[0];
  if (!market) throw new Error('expected a prediction market');
  return market;
}

describe('InMemoryStateStore', () => {
  test('initial prediction price is consistent with reserves', () => {
    const store = new InMemoryStateStore({ seed: 1 });
    const market = firstMarket(store);
    expect(market.yesPrice).toBeCloseTo(
      market.yesShares / (market.yesShares + market.noShares)
    );
    expect(market.yesPrice + market.noPrice).toBeCloseTo(1);
  });

  test('rejects invalid buy amounts and resolved markets', async () => {
    const store = new InMemoryStateStore({ seed: 2 });
    const market = firstMarket(store);
    for (const amount of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        store.buyPredictionShares('u1', market.id, 'YES', amount).success
      ).toBe(false);
    }
    await store.resolveQuestion(market.id, true);
    expect(store.buyPredictionShares('u1', market.id, 'YES', 10).success).toBe(
      false
    );
  });

  test('sell aggregates same-side lots, updates reserves and realizes PnL', () => {
    const store = new InMemoryStateStore({ seed: 3, startingBalance: 1000 });
    const market = firstMarket(store);
    const a = store.buyPredictionShares('u1', market.id, 'YES', 100);
    const b = store.buyPredictionShares('u1', market.id, 'YES', 100);
    expect(a.success && b.success).toBe(true);
    const totalShares = (a.shares ?? 0) + (b.shares ?? 0);
    const yesBefore = market.yesShares;

    const sold = store.sellPredictionShares(
      'u1',
      market.id,
      'YES',
      totalShares
    );
    expect(sold.success).toBe(true);
    expect(market.yesShares).toBeCloseTo(yesBefore - totalShares);

    const user = store.getOrCreateUser('u1');
    expect(user.predictionPositions).toHaveLength(0);
    // Balance conservation: realized PnL equals net cash change
    expect(user.balance - 1000).toBeCloseTo(user.totalPnl);
  });

  test('resolution pays winning positions once', async () => {
    const store = new InMemoryStateStore({ seed: 4, startingBalance: 1000 });
    const market = firstMarket(store);
    const buy = store.buyPredictionShares('u1', market.id, 'YES', 100);
    const shares = buy.shares ?? 0;

    await store.resolveQuestion(market.id, true);
    await store.resolveQuestion(market.id, true); // idempotent

    const user = store.getOrCreateUser('u1');
    expect(user.balance).toBeCloseTo(900 + shares);
    expect(user.totalPnl).toBeCloseTo(shares - 100);
    expect(user.predictionPositions).toHaveLength(0);
  });

  test('resolving an unknown id throws', async () => {
    const store = new InMemoryStateStore({ seed: 5 });
    await expect(store.resolveQuestion('nope', true)).rejects.toThrow();
  });

  test('perp PnL treats size as notional', () => {
    const store = new InMemoryStateStore({ seed: 6, startingBalance: 10_000 });
    const perp = store.getPerpMarkets()[0]!;
    const opened = store.openPerpPosition('u1', perp.ticker, 'LONG', 1000, 10);
    expect(opened.success).toBe(true);
    const entry = perp.price;
    perp.price = entry * 1.1; // +10%

    const closed = store.closePerpPosition('u1', opened.positionId!);
    // 10% move on 1000 notional = 100 (not 0.1 * entry * 1000)
    expect(closed.totalCost).toBeCloseTo(100);
  });

  test('getActors(0) returns no actors and results are copies', async () => {
    const store = new InMemoryStateStore({ seed: 7 });
    expect(await store.getActors(0)).toEqual([]);
    const actors = await store.getActors();
    actors[0]!.name = 'mutated';
    expect((await store.getActors())[0]!.name).not.toBe('mutated');
  });

  test('short simulations resolve within their duration', () => {
    const store = new InMemoryStateStore({ seed: 8, durationDays: 7 });
    for (const market of store.getState().predictionMarkets) {
      expect(market.resolvesOnDay).toBeLessThanOrEqual(7);
      expect(market.resolvesOnDay).toBeGreaterThanOrEqual(7);
    }
  });

  test('rejects invalid configuration', () => {
    expect(() => new InMemoryStateStore({ durationDays: 0 })).toThrow();
    expect(() => new InMemoryStateStore({ numAgents: 1.5 })).toThrow();
    expect(() => new InMemoryStateStore({ startingBalance: -1 })).toThrow();
  });
});
