/**
 * Fee Redistribution Service
 *
 * Manages the stability fund for maintaining NPC liquidity.
 * - Collects a portion of platform fees into a stability fund
 * - Redistributes to NPCs whose balance falls below threshold
 * - Keeps the economy liquid and prevents NPCs from going to $0
 *
 * @module engine/services/fee-redistribution-service
 */

import {
  actorState,
  asc,
  type DrizzleClient,
  db,
  eq,
  gameConfigs,
  inArray,
  sql,
  type Transaction,
  withTransaction,
} from '@feed/db';
import { logger } from '@feed/shared';
import { StaticDataRegistry } from './static-data-registry';

/**
 * Configuration for the stability fund system
 */
export const STABILITY_FUND_CONFIG = {
  /**
   * Portion of platform fees diverted to stability fund (30%)
   * Platform gets 50% of total fees, we take 30% of that = 15% of total fees
   */
  PLATFORM_FEE_DIVERSION_RATE: 0.3,

  /**
   * Threshold for NPC top-up as ratio of tier minimum (20%)
   * NPCs below this get priority for redistribution
   */
  TOP_UP_THRESHOLD_RATIO: 0.2,

  /**
   * Target balance after top-up as ratio of tier minimum (50%)
   * We don't fill to 100% - NPCs need to earn the rest
   */
  TOP_UP_TARGET_RATIO: 0.5,

  /**
   * Maximum amount to redistribute per tick ($50,000)
   * Prevents draining the fund too quickly
   */
  MAX_REDISTRIBUTION_PER_TICK: 50000,

  /**
   * Maximum NPCs to top-up per tick (10)
   * Spreads the love over multiple ticks
   */
  MAX_NPCS_PER_TICK: 10,

  /**
   * Minimum fund balance before redistribution ($10,000)
   * Keep a reserve for emergencies
   */
  MIN_FUND_RESERVE: 10000,

  /**
   * GameConfig key for storing fund balance
   */
  FUND_BALANCE_KEY: 'stability_fund_balance',
} as const;

/**
 * Tier minimum balances (must match GameBootstrapService)
 */
const TIER_MINIMUMS: Record<string, number> = {
  S_TIER: 50000,
  A_TIER: 25000,
  B_TIER: 10000,
  C_TIER: 5000,
};

const DEFAULT_TIER_MINIMUM = 5000;

/**
 * Result of a redistribution operation
 */
export interface RedistributionResult {
  npcsToppedUp: number;
  totalDistributed: number;
  fundBalanceBefore: number;
  fundBalanceAfter: number;
  details: Array<{
    npcId: string;
    npcName: string;
    balanceBefore: number;
    balanceAfter: number;
    amountReceived: number;
  }>;
}

/**
 * Fee Redistribution Service
 *
 * Maintains the stability fund and redistributes to struggling NPCs.
 */
export class FeeRedistributionService {
  /**
   * Get current stability fund balance
   */
  static async getFundBalance(): Promise<number> {
    const [config] = await db
      .select({ value: gameConfigs.value })
      .from(gameConfigs)
      .where(eq(gameConfigs.key, STABILITY_FUND_CONFIG.FUND_BALANCE_KEY))
      .limit(1);

    if (!config) {
      return 0;
    }

    const balance = Number(config.value);
    return Number.isNaN(balance) ? 0 : balance;
  }

  /**
   * Add funds to the stability fund (called when fees are collected)
   *
   * Uses a single atomic upsert so concurrent fee collections never lose
   * increments. Pass the active transaction so the credit commits or rolls
   * back together with the fee that funded it.
   *
   * @param amount - Amount to add to the fund
   * @param tx - Transaction (or client) to run in; defaults to the shared db
   */
  static async addToFund(
    amount: number,
    tx: Transaction | DrizzleClient = db
  ): Promise<void> {
    if (!Number.isFinite(amount)) {
      throw new Error(`Stability fund amount must be finite, got ${amount}`);
    }
    if (amount <= 0) return;

    const now = new Date();
    const [updated] = await tx
      .insert(gameConfigs)
      .values({
        id: STABILITY_FUND_CONFIG.FUND_BALANCE_KEY,
        key: STABILITY_FUND_CONFIG.FUND_BALANCE_KEY,
        value: amount,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: gameConfigs.key,
        set: {
          value: sql`to_json(COALESCE((${gameConfigs.value} #>> '{}')::numeric, 0) + ${amount})`,
          updatedAt: now,
        },
      })
      .returning({ value: gameConfigs.value });

    logger.debug(
      'Added to stability fund',
      { amount, newBalance: updated?.value },
      'FeeRedistributionService'
    );
  }

  /**
   * Calculate the amount to divert from platform fees
   *
   * @param platformFeeAmount - The platform's share of the fee
   * @returns Amount to divert to stability fund
   */
  static calculateDiversionAmount(platformFeeAmount: number): number {
    return (
      platformFeeAmount * STABILITY_FUND_CONFIG.PLATFORM_FEE_DIVERSION_RATE
    );
  }

  /**
   * Get tier minimum for an NPC
   */
  private static getTierMinimum(tier: string | null | undefined): number {
    if (!tier) return DEFAULT_TIER_MINIMUM;
    return TIER_MINIMUMS[tier] ?? DEFAULT_TIER_MINIMUM;
  }

  /**
   * Find NPCs that need redistribution
   *
   * @returns Array of NPCs below threshold with their details
   */
  private static async findNPCsBelowThreshold(): Promise<
    Array<{
      id: string;
      name: string;
      tier: string | null;
      currentBalance: number;
      threshold: number;
      target: number;
      amountNeeded: number;
    }>
  > {
    // Get all actor states
    const allActorStates = await db
      .select({
        id: actorState.id,
        tradingBalance: actorState.tradingBalance,
      })
      .from(actorState);

    // Get static actor data for tier info
    const eligibleNPCs: Array<{
      id: string;
      name: string;
      tier: string | null;
      currentBalance: number;
      threshold: number;
      target: number;
      amountNeeded: number;
    }> = [];

    for (const state of allActorStates) {
      const actor = StaticDataRegistry.getActor(state.id);
      if (!actor) continue;

      const tierMinimum = FeeRedistributionService.getTierMinimum(actor.tier);
      const threshold =
        tierMinimum * STABILITY_FUND_CONFIG.TOP_UP_THRESHOLD_RATIO;
      const target = tierMinimum * STABILITY_FUND_CONFIG.TOP_UP_TARGET_RATIO;
      const currentBalance = Number(state.tradingBalance);

      if (currentBalance < threshold) {
        const amountNeeded = Math.max(0, target - currentBalance);
        eligibleNPCs.push({
          id: state.id,
          name: actor.name,
          tier: actor.tier,
          currentBalance,
          threshold,
          target,
          amountNeeded,
        });
      }
    }

    // Sort by balance (lowest first - most in need get priority)
    eligibleNPCs.sort((a, b) => a.currentBalance - b.currentBalance);

    return eligibleNPCs;
  }

  /**
   * Redistribute funds to NPCs below threshold
   *
   * @returns Result of the redistribution
   */
  static async redistributeFunds(): Promise<RedistributionResult> {
    const fundBalanceBefore = await FeeRedistributionService.getFundBalance();

    // Check if we have enough in the fund
    const availableForDistribution =
      fundBalanceBefore - STABILITY_FUND_CONFIG.MIN_FUND_RESERVE;

    if (availableForDistribution <= 0) {
      logger.info(
        'Stability fund below reserve threshold, skipping redistribution',
        {
          fundBalance: fundBalanceBefore,
          reserve: STABILITY_FUND_CONFIG.MIN_FUND_RESERVE,
        },
        'FeeRedistributionService'
      );
      return {
        npcsToppedUp: 0,
        totalDistributed: 0,
        fundBalanceBefore,
        fundBalanceAfter: fundBalanceBefore,
        details: [],
      };
    }

    // Find NPCs that need help
    const eligibleNPCs =
      await FeeRedistributionService.findNPCsBelowThreshold();

    if (eligibleNPCs.length === 0) {
      logger.debug(
        'No NPCs below threshold, skipping redistribution',
        { fundBalance: fundBalanceBefore },
        'FeeRedistributionService'
      );
      return {
        npcsToppedUp: 0,
        totalDistributed: 0,
        fundBalanceBefore,
        fundBalanceAfter: fundBalanceBefore,
        details: [],
      };
    }

    const candidateIds = eligibleNPCs
      .slice(0, STABILITY_FUND_CONFIG.MAX_NPCS_PER_TICK)
      .map((npc) => npc.id);
    const candidatesById = new Map(eligibleNPCs.map((npc) => [npc.id, npc]));

    // Debit the fund and credit NPCs atomically. Lock order is actor rows
    // (by id) then the fund row — the same order trade paths use (actor
    // balance first, fee/fund last) — so this cannot deadlock with trading.
    const { totalDistributed, details, fundBalanceAfter } =
      await withTransaction(async (tx) => {
        const lockedActors = await tx
          .select({
            id: actorState.id,
            tradingBalance: actorState.tradingBalance,
          })
          .from(actorState)
          .where(inArray(actorState.id, candidateIds))
          .orderBy(asc(actorState.id))
          .for('update');

        const [fundRow] = await tx
          .select({ value: gameConfigs.value })
          .from(gameConfigs)
          .where(eq(gameConfigs.key, STABILITY_FUND_CONFIG.FUND_BALANCE_KEY))
          .for('update');
        const lockedFundBalance = fundRow ? Number(fundRow.value) : 0;
        if (!Number.isFinite(lockedFundBalance)) {
          throw new Error(
            `Stability fund balance is not numeric: ${String(fundRow?.value)}`
          );
        }

        // Recompute the budget from the locked fund balance.
        const maxToDistribute = Math.min(
          lockedFundBalance - STABILITY_FUND_CONFIG.MIN_FUND_RESERVE,
          STABILITY_FUND_CONFIG.MAX_REDISTRIBUTION_PER_TICK
        );

        // Preserve neediest-first priority using the locked balances.
        const lockedById = new Map(
          lockedActors.map((row) => [row.id, Number(row.tradingBalance)])
        );
        let distributed = 0;
        const topUps: RedistributionResult['details'] = [];

        for (const npcId of candidateIds) {
          if (distributed >= maxToDistribute) break;
          const npc = candidatesById.get(npcId);
          const currentBalance = lockedById.get(npcId);
          if (!npc || currentBalance === undefined) continue;
          // Balance may have recovered since the unlocked scan.
          if (currentBalance >= npc.threshold) continue;

          const amountToGive = Math.min(
            Math.max(0, npc.target - currentBalance),
            maxToDistribute - distributed
          );
          if (amountToGive <= 0) continue;

          const [credited] = await tx
            .update(actorState)
            .set({
              tradingBalance: sql`${actorState.tradingBalance} + ${amountToGive}`,
              updatedAt: new Date(),
            })
            .where(eq(actorState.id, npcId))
            .returning({ tradingBalance: actorState.tradingBalance });

          const balanceAfter = Number(credited?.tradingBalance);
          distributed += amountToGive;
          topUps.push({
            npcId,
            npcName: npc.name,
            balanceBefore: currentBalance,
            balanceAfter,
            amountReceived: amountToGive,
          });

          logger.info(
            `Topped up NPC ${npc.name}`,
            {
              npcId,
              balanceBefore: currentBalance,
              balanceAfter,
              amount: amountToGive,
            },
            'FeeRedistributionService'
          );
        }

        if (distributed > 0) {
          await tx
            .update(gameConfigs)
            .set({
              value: sql`to_json((${gameConfigs.value} #>> '{}')::numeric - ${distributed})`,
              updatedAt: new Date(),
            })
            .where(eq(gameConfigs.key, STABILITY_FUND_CONFIG.FUND_BALANCE_KEY));
        }

        return {
          totalDistributed: distributed,
          details: topUps,
          fundBalanceAfter: lockedFundBalance - distributed,
        };
      });

    logger.info(
      'Redistribution completed',
      {
        npcsToppedUp: details.length,
        totalDistributed,
        fundBalanceBefore,
        fundBalanceAfter,
        eligibleNPCsRemaining: eligibleNPCs.length - details.length,
      },
      'FeeRedistributionService'
    );

    return {
      npcsToppedUp: details.length,
      totalDistributed,
      fundBalanceBefore,
      fundBalanceAfter,
      details,
    };
  }

  /**
   * Get statistics about the stability fund and NPC balances
   */
  static async getStats(): Promise<{
    fundBalance: number;
    npcsTotal: number;
    npcsBelowThreshold: number;
    totalDeficit: number;
    averageBalance: number;
  }> {
    const fundBalance = await FeeRedistributionService.getFundBalance();
    const eligibleNPCs =
      await FeeRedistributionService.findNPCsBelowThreshold();

    // Get all actor balances
    const allStates = await db
      .select({ tradingBalance: actorState.tradingBalance })
      .from(actorState);

    const totalBalance = allStates.reduce(
      (sum, s) => sum + Number(s.tradingBalance),
      0
    );
    const averageBalance =
      allStates.length > 0 ? totalBalance / allStates.length : 0;
    const totalDeficit = eligibleNPCs.reduce(
      (sum, n) => sum + n.amountNeeded,
      0
    );

    return {
      fundBalance,
      npcsTotal: allStates.length,
      npcsBelowThreshold: eligibleNPCs.length,
      totalDeficit,
      averageBalance,
    };
  }
}
