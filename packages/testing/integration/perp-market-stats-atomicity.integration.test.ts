/**
 * Integration test: PerpDbAdapter market stats atomicity
 *
 * Verifies against a real database that open-interest/volume deltas from
 * concurrent trades are never lost, and that partial stats updates do not
 * overwrite fields they did not set.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PerpDbAdapter } from '@feed/core/markets/perps';
import { db, eq, perpMarketSnapshots } from '@feed/db';

const TICKER = `ITEST${Date.now().toString(36).toUpperCase()}`;

describe('PerpDbAdapter market stats atomicity', () => {
  beforeAll(async () => {
    await db.insert(perpMarketSnapshots).values({
      ticker: TICKER,
      organizationId: `org-${TICKER.toLowerCase()}`,
      currentPrice: 100,
      high24h: 100,
      low24h: 100,
      metrics24hResetAt: new Date(),
      price24hAgoUpdatedAt: new Date(),
      fundingRate: {
        ticker: TICKER,
        rate: 0,
        nextFundingTime: new Date().toISOString(),
        predictedRate: 0,
      },
    });
  });

  afterAll(async () => {
    await db
      .delete(perpMarketSnapshots)
      .where(eq(perpMarketSnapshots.ticker, TICKER));
  });

  it('conserves concurrent open-interest and volume deltas', async () => {
    const adapter = new PerpDbAdapter();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        adapter.applyMarketDeltas(TICKER, { openInterest: 10, volume24h: 10 })
      )
    );

    const [row] = await db
      .select()
      .from(perpMarketSnapshots)
      .where(eq(perpMarketSnapshots.ticker, TICKER));
    expect(row?.openInterest).toBe(120);
    expect(row?.volume24h).toBe(120);
  });

  it('does not overwrite open interest when updating unrelated fields', async () => {
    const adapter = new PerpDbAdapter();
    await Promise.all([
      adapter.updateMarketStats(TICKER, { currentPrice: 101, markPrice: 101 }),
      adapter.applyMarketDeltas(TICKER, { openInterest: -20 }),
      adapter.updateMarketStats(TICKER, { spreadBps: 12 }),
    ]);

    const [row] = await db
      .select()
      .from(perpMarketSnapshots)
      .where(eq(perpMarketSnapshots.ticker, TICKER));
    expect(row?.openInterest).toBe(100);
    expect(row?.currentPrice).toBe(101);
    expect(row?.spreadBps).toBe(12);
  });
});
