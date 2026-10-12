/**
 * Integration Tests: GameBootstrapService concurrency and repair
 *
 * Runs against a real Postgres database (DATABASE_URL). Verifies that
 * overlapping full syncs never double-credit NPC balances and that a pool
 * created earlier with a stale `hasPool=false` flag is reconciled.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { actorState, db, eq, pools } from '@feed/db';
import { GameBootstrapService, StaticDataRegistry } from '@feed/engine';

const actor = StaticDataRegistry.getAllActors()[0];
let originalState: { tradingBalance: string; hasPool: boolean } | null = null;

describe('GameBootstrapService concurrency', () => {
  beforeAll(async () => {
    if (!actor) throw new Error('No static actors available');
    await GameBootstrapService.forceFullSync();

    const [state] = await db
      .select({
        tradingBalance: actorState.tradingBalance,
        hasPool: actorState.hasPool,
      })
      .from(actorState)
      .where(eq(actorState.id, actor.id));
    originalState = state ?? null;

    // The initial sync guarantees the actor's pool row exists.
    const [pool] = await db
      .select({ id: pools.id })
      .from(pools)
      .where(eq(pools.id, actor.id));
    expect(pool).toBeDefined();
  });

  afterAll(async () => {
    if (!actor || !originalState) return;
    await db
      .update(actorState)
      .set(originalState)
      .where(eq(actorState.id, actor.id));
  });

  it('tops an actor up to its minimum exactly once under overlapping syncs', async () => {
    if (!actor) throw new Error('No static actors available');
    await db
      .update(actorState)
      .set({ tradingBalance: '0', hasPool: false })
      .where(eq(actorState.id, actor.id));

    await Promise.all([
      GameBootstrapService.forceFullSync(),
      GameBootstrapService.forceFullSync(),
      GameBootstrapService.bootstrapIfNeeded(),
    ]);

    const [state] = await db
      .select({
        tradingBalance: actorState.tradingBalance,
        hasPool: actorState.hasPool,
      })
      .from(actorState)
      .where(eq(actorState.id, actor.id));
    expect(Number(state?.tradingBalance)).toBe(
      GameBootstrapService.getMinimumBalance(actor.tier ?? 'C_TIER')
    );
    // The pool already existed while hasPool was false: the flag is repaired
    expect(state?.hasPool).toBe(true);
  });
});
