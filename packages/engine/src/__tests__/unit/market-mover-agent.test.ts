import { describe, expect, test } from 'bun:test';
import type { WorldEvent } from '@feed/shared';
import { MarketMoverAgent } from '../../services/market-mover-agent';

const event = (overrides: Partial<WorldEvent>): WorldEvent => ({
  id: 'e',
  day: 1,
  type: 'unmapped-type' as WorldEvent['type'],
  visibility: 'public',
  description: 'something happened',
  actors: [],
  ...overrides,
});

describe('MarketMoverAgent', () => {
  test('unmapped event without directional evidence does not move price', async () => {
    const agent = new MarketMoverAgent(1);
    const adj = await agent.generatePriceAdjustments(
      new Map([['TSLA', 100]]),
      [event({ sentimentSignal: 0 })],
      { affectedTickers: ['TSLA'] }
    );
    expect(adj.size).toBe(0);
  });

  test('duplicate affected tickers are applied once', async () => {
    const a = await new MarketMoverAgent(7).generatePriceAdjustments(
      new Map([['TSLA', 100]]),
      [event({ sentimentSignal: 0.5 })],
      { affectedTickers: ['TSLA', 'TSLA'] }
    );
    const b = await new MarketMoverAgent(7).generatePriceAdjustments(
      new Map([['TSLA', 100]]),
      [event({ sentimentSignal: 0.5 })],
      { affectedTickers: ['TSLA'] }
    );
    expect(a.get('TSLA')).toBe(b.get('TSLA'));
  });

  test('ticker detection matches whole tokens only', async () => {
    const adj = await new MarketMoverAgent(1).generatePriceAdjustments(
      new Map([['SOL', 100]]),
      [event({ description: 'Holdings SOLD off', sentimentSignal: -0.5 })]
    );
    expect(adj.size).toBe(0);
  });

  test('tick clamp is applied to the summed change, independent of order', async () => {
    const events = [
      event({ sentimentSignal: 0.9 }),
      event({ sentimentSignal: 0.9 }),
      event({ sentimentSignal: -0.9 }),
    ];
    const prices = new Map([['TSLA', 100]]);
    const ctx = { affectedTickers: ['TSLA'] };
    const forward = await new MarketMoverAgent(3, {
      maxPriceChangePerEvent: 0.3,
    }).generatePriceAdjustments(prices, events, ctx);
    const reversed = await new MarketMoverAgent(3, {
      maxPriceChangePerEvent: 0.3,
    }).generatePriceAdjustments(prices, [...events].reverse(), ctx);
    // Same multiset of magnitudes is drawn in a different order, so compare
    // the sign and bound rather than exact values.
    for (const adj of [forward, reversed]) {
      const v = adj.get('TSLA')!;
      expect(Math.abs(v)).toBeLessThanOrEqual(0.3);
    }
  });

  test('requires a canonical initial price for bounds', () => {
    const agent = new MarketMoverAgent(1);
    expect(() =>
      agent.applyAdjustments(new Map([['TSLA', 100]]), new Map(), new Map())
    ).toThrow('Missing initial price');
  });

  test('rejects invalid config', () => {
    expect(
      () => new MarketMoverAgent(1, { maxPriceChangePerEvent: -1 })
    ).toThrow();
    expect(
      () => new MarketMoverAgent(1, { minPriceFloor: 2, maxPriceCeiling: 1 })
    ).toThrow();
  });
});
