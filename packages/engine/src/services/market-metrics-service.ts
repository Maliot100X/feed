/**
 * Market Metrics Service
 *
 * Provides quantitative metrics for market-aware question generation.
 * Gathers volatility, trading activity, and liquidity metrics to inform
 * the question generation process about market dynamics.
 *
 * Part of BAB-5: Connecting Markets to Game Generation Engine
 *
 * @module engine/services/market-metrics-service
 */

import { PredictionPricing } from '@feed/core/markets/prediction/client';
import {
  and,
  db,
  desc,
  eq,
  gte,
  inArray,
  markets,
  perpMarketSnapshots,
  positions,
  predictionPriceHistories,
  sql,
  stockPrices,
} from '@feed/db';
import { logger } from '@feed/shared';
import { first, last } from '../utils/array-utils';
import { formatError } from '../utils/error-utils';
import { StaticDataRegistry } from './static-data-registry';

/**
 * Metrics for a single prediction market
 */
export interface PredictionMarketMetrics {
  marketId: string;
  question: string;
  /** Current probability (0-1) */
  currentProbability: number;
  /** Price change over last 24h (-1 to 1) */
  priceChange24h: number;
  /** Volatility score (0-1, higher = more volatile) */
  volatility: number;
  /** Number of active positions */
  positionCount: number;
  /** Total liquidity in market */
  liquidity: number;
  /** Trading activity level (low/medium/high) */
  activityLevel: 'low' | 'medium' | 'high';
}

/**
 * Metrics for perpetual markets (company stocks)
 */
export interface PerpMarketMetrics {
  orgId: string;
  orgName: string;
  /** Current price */
  currentPrice: number;
  /** Initial/baseline price */
  initialPrice: number;
  /** Price change percentage over period */
  priceChangePercent: number;
  /** Volatility score (0-1) */
  volatility: number;
  /** Is trending (significant movement) */
  isTrending: boolean;
  /** Direction of trend */
  trendDirection: 'up' | 'down' | 'neutral';
}

/**
 * Aggregated market metrics for question generation
 */
export interface MarketMetricsContext {
  /** Most volatile prediction markets */
  volatilePredictions: PredictionMarketMetrics[];
  /** Most active prediction markets */
  activePredictions: PredictionMarketMetrics[];
  /** Trending perp markets (stocks) */
  trendingPerps: PerpMarketMetrics[];
  /** Markets with extreme probabilities (near 0 or 1) */
  extremeProbabilities: PredictionMarketMetrics[];
  /** Summary statistics */
  summary: {
    avgPredictionVolatility: number;
    avgPerpVolatility: number;
    totalActivePositions: number;
    totalLiquidity: number;
    marketHealthScore: number; // 0-1, overall market health
  };
  /** Formatted context for LLM prompts */
  promptContext: string;
}

/** Probability std-dev at which the volatility score saturates to 1. */
const PROBABILITY_STDDEV_SATURATION = 0.3;
/** Per-observation return std-dev (10%) at which the volatility score saturates to 1. */
const RETURN_STDDEV_SATURATION = 0.1;

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Volatility score (0-1) for a probability series (values in [0,1]).
 * Returns 0 when fewer than two observations exist.
 */
export function calculateProbabilityVolatility(
  probabilities: number[]
): number {
  if (probabilities.length < 2) return 0;
  return Math.min(
    1,
    standardDeviation(probabilities) / PROBABILITY_STDDEV_SATURATION
  );
}

/**
 * Scale-invariant volatility score (0-1) for a chronological price series,
 * based on the std-dev of simple per-observation returns. Non-positive or
 * non-finite prices are excluded. Returns 0 when fewer than two returns exist.
 */
export function calculateReturnVolatility(
  chronologicalPrices: number[]
): number {
  const valid = chronologicalPrices.filter((p) => Number.isFinite(p) && p > 0);
  const returns: number[] = [];
  for (let i = 1; i < valid.length; i++) {
    returns.push(valid[i]! / valid[i - 1]! - 1);
  }
  if (returns.length < 2) return 0;
  return Math.min(1, standardDeviation(returns) / RETURN_STDDEV_SATURATION);
}

/**
 * Format the leading outcome of a binary market, e.g. 0.05 => "95% NO".
 */
export function formatLeadingOutcome(yesProbability: number): string {
  return yesProbability >= 0.5
    ? `${(yesProbability * 100).toFixed(0)}% YES`
    : `${((1 - yesProbability) * 100).toFixed(0)}% NO`;
}

/**
 * Service for gathering market metrics to inform question generation
 */
export class MarketMetricsService {
  /**
   * Gather comprehensive market metrics for question generation
   *
   * Scalability considerations:
   * - Uses Promise.all for parallel DB queries
   * - Each query is limited (50 markets, 100 snapshots)
   * - Results are top-5 sliced for prompt efficiency
   * - Org names enriched from in-memory registry (no extra DB call)
   *
   * @param lookbackHours - Hours to look back for metrics (default: 24)
   * @returns Market metrics context
   */
  static async gatherMetrics(
    lookbackHours = 24
  ): Promise<MarketMetricsContext> {
    const startTime = Date.now();
    const lookbackDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const [predictionMetrics, perpMetrics] = await Promise.all([
      this.gatherPredictionMetrics(lookbackDate),
      this.gatherPerpMetrics(lookbackDate),
    ]);

    // Calculate aggregated metrics
    const volatilePredictions = [...predictionMetrics]
      .sort((a, b) => b.volatility - a.volatility)
      .slice(0, 5);

    const activePredictions = [...predictionMetrics]
      .sort((a, b) => b.positionCount - a.positionCount)
      .slice(0, 5);

    const extremeProbabilities = predictionMetrics
      .filter((m) => m.currentProbability < 0.1 || m.currentProbability > 0.9)
      .slice(0, 5);

    const trendingPerps = perpMetrics
      .filter((m) => m.isTrending)
      .sort(
        (a, b) =>
          Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent)
      )
      .slice(0, 5);

    // Summary statistics
    const avgPredictionVolatility =
      predictionMetrics.length > 0
        ? predictionMetrics.reduce((sum, m) => sum + m.volatility, 0) /
          predictionMetrics.length
        : 0;

    const avgPerpVolatility =
      perpMetrics.length > 0
        ? perpMetrics.reduce((sum, m) => sum + m.volatility, 0) /
          perpMetrics.length
        : 0;

    const totalActivePositions = predictionMetrics.reduce(
      (sum, m) => sum + m.positionCount,
      0
    );

    const totalLiquidity = predictionMetrics.reduce(
      (sum, m) => sum + m.liquidity,
      0
    );

    // Market health: based on activity and liquidity
    const marketHealthScore = Math.min(
      1,
      (totalActivePositions / 100 + totalLiquidity / 1_000_000) / 2
    );

    const context: MarketMetricsContext = {
      volatilePredictions,
      activePredictions,
      trendingPerps,
      extremeProbabilities,
      summary: {
        avgPredictionVolatility,
        avgPerpVolatility,
        totalActivePositions,
        totalLiquidity,
        marketHealthScore,
      },
      promptContext: this.formatPromptContext({
        volatilePredictions,
        activePredictions,
        trendingPerps,
        extremeProbabilities,
        avgPredictionVolatility,
        avgPerpVolatility,
      }),
    };

    logger.debug(
      'Market metrics gathered',
      {
        durationMs: Date.now() - startTime,
        predictionCount: predictionMetrics.length,
        perpCount: perpMetrics.length,
        volatileCount: volatilePredictions.length,
        trendingCount: trendingPerps.length,
      },
      'MarketMetricsService'
    );

    return context;
  }

  /**
   * Gather metrics for prediction markets
   *
   * Scalability: Limits to 50 active markets maximum and uses indexed queries
   * for position counts. Price history is filtered by date and limited.
   */
  private static async gatherPredictionMetrics(
    lookbackDate: Date
  ): Promise<PredictionMarketMetrics[]> {
    // Get active markets with position counts (capped at 50 for performance)
    const activeMarkets = await db
      .select({
        id: markets.id,
        question: markets.question,
        yesShares: markets.yesShares,
        noShares: markets.noShares,
        liquidity: markets.liquidity,
        resolved: markets.resolved,
      })
      .from(markets)
      .where(eq(markets.resolved, false))
      .limit(50);

    if (activeMarkets.length === 0) return [];
    const activeMarketIds = activeMarkets.map((m) => m.id);

    // Get position counts per market
    const positionCounts = await db
      .select({
        marketId: positions.marketId,
        count: sql<number>`count(*)::int`,
      })
      .from(positions)
      .where(
        and(
          eq(positions.status, 'active'),
          inArray(positions.marketId, activeMarketIds)
        )
      )
      .groupBy(positions.marketId);

    const positionCountMap = new Map(
      positionCounts.map((p) => [p.marketId, p.count])
    );

    // Get price history for volatility calculation (limit to prevent unbounded growth)
    const priceHistories = await db
      .select({
        marketId: predictionPriceHistories.marketId,
        yesPrice: predictionPriceHistories.yesPrice,
        createdAt: predictionPriceHistories.createdAt,
      })
      .from(predictionPriceHistories)
      .where(
        and(
          gte(predictionPriceHistories.createdAt, lookbackDate),
          inArray(predictionPriceHistories.marketId, activeMarketIds)
        )
      )
      .orderBy(desc(predictionPriceHistories.createdAt))
      .limit(1000);

    // Group price history by market
    const historyByMarket = new Map<
      string,
      Array<{ yesPrice: number; createdAt: Date }>
    >();
    for (const h of priceHistories) {
      const existing = historyByMarket.get(h.marketId) || [];
      existing.push({ yesPrice: h.yesPrice, createdAt: h.createdAt });
      historyByMarket.set(h.marketId, existing);
    }

    return activeMarkets.map((market) => {
      // CPMM: YES probability is the NO pool's share of reserves.
      const currentProbability = PredictionPricing.getCurrentPrice(
        Number(market.yesShares),
        Number(market.noShares),
        'yes'
      );
      const liquidity = Number(market.liquidity);
      const positionCount = positionCountMap.get(market.id) || 0;

      // Calculate volatility from price history
      const history = historyByMarket.get(market.id) || [];
      const volatility = calculateProbabilityVolatility(
        history.map((h) => h.yesPrice)
      );

      // Calculate 24h price change
      const priceChange24h = this.calculatePriceChange(
        history.map((h) => ({ yesPrice: h.yesPrice, timestamp: h.createdAt })),
        currentProbability
      );

      // Activity level based on position count
      let activityLevel: 'low' | 'medium' | 'high' = 'low';
      if (positionCount > 20) activityLevel = 'high';
      else if (positionCount > 5) activityLevel = 'medium';

      return {
        marketId: market.id,
        question: market.question,
        currentProbability,
        priceChange24h,
        volatility,
        positionCount,
        liquidity,
        activityLevel,
      };
    });
  }

  /**
   * Gather metrics for perpetual markets (stocks)
   *
   * Scalability: Uses limit(100) to cap query size and enriches org names
   * from in-memory StaticDataRegistry (no additional DB call).
   */
  private static async gatherPerpMetrics(
    lookbackDate: Date
  ): Promise<PerpMarketMetrics[]> {
    // Build org name lookup from static registry (in-memory, no DB call)
    const orgNameMap = new Map<string, string>();
    for (const org of StaticDataRegistry.getAllOrganizations()) {
      orgNameMap.set(org.id, org.name);
    }

    // Get recent stock prices (limit to prevent unbounded growth)
    const recentPrices = await db
      .select({
        orgId: stockPrices.organizationId,
        price: stockPrices.price,
        timestamp: stockPrices.timestamp,
      })
      .from(stockPrices)
      .where(gte(stockPrices.timestamp, lookbackDate))
      .orderBy(desc(stockPrices.timestamp))
      .limit(500);

    // Group by organization
    const pricesByOrg = new Map<
      string,
      Array<{ price: number; timestamp: Date }>
    >();
    for (const p of recentPrices) {
      const existing = pricesByOrg.get(p.orgId) || [];
      existing.push({ price: p.price, timestamp: p.timestamp });
      pricesByOrg.set(p.orgId, existing);
    }

    // Enhance with PerpMarketSnapshot data if available (provides 24h price comparison)
    // Only fetch snapshots for organizations we actually have price data for
    const snapshotMap = new Map<
      string,
      { price24hAgo: number | null; price24hAgoUpdatedAt: Date | null }
    >();
    const orgIds = Array.from(pricesByOrg.keys());

    if (orgIds.length > 0) {
      try {
        const snapshots = await db
          .select({
            organizationId: perpMarketSnapshots.organizationId,
            price24hAgo: perpMarketSnapshots.price24hAgo,
            price24hAgoUpdatedAt: perpMarketSnapshots.price24hAgoUpdatedAt,
          })
          .from(perpMarketSnapshots)
          .where(inArray(perpMarketSnapshots.organizationId, orgIds));

        for (const snapshot of snapshots) {
          snapshotMap.set(snapshot.organizationId, {
            price24hAgo: snapshot.price24hAgo,
            price24hAgoUpdatedAt: snapshot.price24hAgoUpdatedAt,
          });
        }
      } catch (error) {
        logger.error(
          'Failed to query required PerpMarketSnapshot data',
          { error: formatError(error) },
          'MarketMetrics'
        );
        throw error;
      }
    }

    // Freshness window for 24h snapshot (25 hours to allow for slight delays)
    const SNAPSHOT_FRESHNESS_MS = 25 * 60 * 60 * 1000;
    const now = Date.now();

    const metrics: PerpMarketMetrics[] = [];

    for (const [orgId, prices] of pricesByOrg) {
      if (prices.length < 2) continue;

      // Sort by timestamp descending
      prices.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      const currentPriceEntry = first(prices);
      const oldestPriceEntry = last(prices);
      if (!currentPriceEntry || !oldestPriceEntry) continue;

      const currentPrice = currentPriceEntry.price;
      const oldestPrice = oldestPriceEntry.price;

      // Use 24h ago price from snapshot if available and fresh (more accurate)
      // Explicit null check to ensure TypeScript narrows snapshot from T | undefined
      const snapshot = snapshotMap.get(orgId);
      const referencePrice =
        snapshot != null &&
        snapshot.price24hAgo != null &&
        snapshot.price24hAgoUpdatedAt != null &&
        now - snapshot.price24hAgoUpdatedAt.getTime() <= SNAPSHOT_FRESHNESS_MS
          ? snapshot.price24hAgo
          : oldestPrice;

      const priceChangePercent =
        referencePrice != null && referencePrice > 0
          ? ((currentPrice - referencePrice) / referencePrice) * 100
          : 0;

      // prices are sorted newest-first; returns are computed chronologically
      const volatility = calculateReturnVolatility(
        prices.map((p) => Number(p.price)).reverse()
      );

      // Trending if > 10% change
      const isTrending = Math.abs(priceChangePercent) > 10;
      const trendDirection: 'up' | 'down' | 'neutral' =
        priceChangePercent > 5
          ? 'up'
          : priceChangePercent < -5
            ? 'down'
            : 'neutral';

      metrics.push({
        orgId,
        orgName: orgNameMap.get(orgId) ?? orgId, // Use friendly name from registry
        currentPrice,
        initialPrice: oldestPrice,
        priceChangePercent,
        volatility,
        isTrending,
        trendDirection,
      });
    }

    return metrics;
  }

  /**
   * Calculate price change over period
   */
  private static calculatePriceChange(
    history: Array<{ yesPrice: number; timestamp: Date }>,
    currentPrice: number
  ): number {
    if (history.length === 0) return 0;

    // Get oldest price in history
    const oldestPrice = history[history.length - 1]?.yesPrice ?? currentPrice;
    return currentPrice - oldestPrice;
  }

  /**
   * Format metrics as prompt context for LLM
   */
  private static formatPromptContext(data: {
    volatilePredictions: PredictionMarketMetrics[];
    activePredictions: PredictionMarketMetrics[];
    trendingPerps: PerpMarketMetrics[];
    extremeProbabilities: PredictionMarketMetrics[];
    avgPredictionVolatility: number;
    avgPerpVolatility: number;
  }): string {
    const parts: string[] = [];

    // Volatile markets - good for follow-up questions
    if (data.volatilePredictions.length > 0) {
      parts.push(
        `VOLATILE MARKETS (high price movement - consider follow-up questions):\n${data.volatilePredictions
          .slice(0, 3)
          .map(
            (m) =>
              `- "${m.question.substring(0, 50)}..." (volatility: ${(m.volatility * 100).toFixed(0)}%, prob: ${(m.currentProbability * 100).toFixed(0)}%)`
          )
          .join('\n')}`
      );
    }

    // Active markets - popular topics
    if (data.activePredictions.length > 0) {
      parts.push(
        `ACTIVE MARKETS (high trading activity - popular topics):\n${data.activePredictions
          .slice(0, 3)
          .map(
            (m) =>
              `- "${m.question.substring(0, 50)}..." (${m.positionCount} positions, ${m.activityLevel} activity)`
          )
          .join('\n')}`
      );
    }

    // Trending stocks - company news opportunities
    if (data.trendingPerps.length > 0) {
      parts.push(
        `TRENDING COMPANIES (significant price movement):\n${data.trendingPerps
          .slice(0, 3)
          .map(
            (m) =>
              `- ${m.orgName}: ${m.trendDirection === 'up' ? '📈' : '📉'} ${m.priceChangePercent > 0 ? '+' : ''}${m.priceChangePercent.toFixed(1)}%`
          )
          .join('\n')}`
      );
    }

    // Extreme probabilities - potential resolution soon or upset opportunities
    if (data.extremeProbabilities.length > 0) {
      parts.push(
        `EXTREME ODDS (near-certain outcomes or upset potential):\n${data.extremeProbabilities
          .slice(0, 3)
          .map(
            (m) =>
              `- "${m.question.substring(0, 50)}..." (${formatLeadingOutcome(m.currentProbability)})`
          )
          .join('\n')}`
      );
    }

    if (parts.length === 0) {
      return 'MARKET METRICS: No significant market activity detected.';
    }

    return `MARKET METRICS (use for context-aware question generation):\n${parts.join('\n\n')}`;
  }
}
