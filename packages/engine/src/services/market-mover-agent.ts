/**
 * Market Mover Agent
 *
 * Translates world events into price movements for perpetual markets.
 * This is the bridge between the Narrative Layer (events) and the Financial Layer (prices).
 *
 * Architecture:
 * - Events occur in GameWorld (leaks, rumors, scandals, etc.)
 * - Market Mover determines how those events should affect prices
 * - Returns percentage changes (deltas), not absolute prices
 *
 * The agent uses volatility buckets to prevent overfitting:
 * - Low: ±2% to ±4%
 * - Medium: ±5% to ±10%
 * - High: ±15% to ±25%
 *
 * The exact percentage within a bucket is selected using seeded RNG for reproducibility.
 */

import type { WorldEvent } from '@feed/shared';
import { SeededRandom } from '../utils/entropy';

/**
 * Volatility bucket for price movements
 */
export type VolatilityBucket = 'low' | 'medium' | 'high';

/**
 * Volatility bucket ranges for price changes
 * Each bucket defines min/max percentage change (absolute value)
 */
const VOLATILITY_BUCKET_RANGES: Record<
  VolatilityBucket,
  { min: number; max: number }
> = {
  low: { min: 0.02, max: 0.04 }, // 2% to 4%
  medium: { min: 0.05, max: 0.1 }, // 5% to 10%
  high: { min: 0.15, max: 0.25 }, // 15% to 25%
};

/**
 * Event type to volatility bucket mapping
 * Maps event types to their default volatility impact
 */
export const EVENT_TYPE_VOLATILITY: Record<
  string,
  { bucket: VolatilityBucket; isNegative: boolean }
> = {
  // Negative events
  leak: { bucket: 'medium', isNegative: true },
  rumor: { bucket: 'medium', isNegative: true },
  scandal: { bucket: 'high', isNegative: true },
  conflict: { bucket: 'medium', isNegative: true },
  revelation: { bucket: 'medium', isNegative: true },
  // Positive events
  development: { bucket: 'medium', isNegative: false },
  deal: { bucket: 'medium', isNegative: false },
  announcement: { bucket: 'low', isNegative: false },
  meeting: { bucket: 'low', isNegative: false },
  // Neutral/context-dependent (use sentiment signal)
  'development:occurred': { bucket: 'low', isNegative: false },
  'news:published': { bucket: 'low', isNegative: false },
};

/**
 * Context for price adjustment decisions
 */
export interface MarketMoverContext {
  /** Tickers that are explicitly affected by the events */
  affectedTickers?: string[];
}

/**
 * Configuration for MarketMoverAgent
 */
export interface MarketMoverConfig {
  /** Maximum price change per event (default: 0.30 for 30%) */
  maxPriceChangePerEvent?: number;
  /** Minimum price as fraction of initial (default: 0.10 for 10%) */
  minPriceFloor?: number;
  /** Maximum price as fraction of initial (default: 4.0 for 400%) */
  maxPriceCeiling?: number;
}

/**
 * Market Mover Agent
 *
 * Deterministic rule-based engine that translates world events into price movements
 * using volatility buckets. Fast, cheap, and consistent.
 */
export class MarketMoverAgent {
  private rng: SeededRandom;
  private config: Required<MarketMoverConfig>;

  constructor(seed: number, config?: MarketMoverConfig) {
    this.rng = new SeededRandom(seed);
    this.config = {
      maxPriceChangePerEvent: config?.maxPriceChangePerEvent ?? 0.3,
      minPriceFloor: config?.minPriceFloor ?? 0.1,
      maxPriceCeiling: config?.maxPriceCeiling ?? 4.0,
    };
    const { maxPriceChangePerEvent, minPriceFloor, maxPriceCeiling } =
      this.config;
    if (
      !Number.isFinite(maxPriceChangePerEvent) ||
      maxPriceChangePerEvent <= 0 ||
      !Number.isFinite(minPriceFloor) ||
      minPriceFloor <= 0 ||
      !Number.isFinite(maxPriceCeiling) ||
      maxPriceCeiling < minPriceFloor
    ) {
      throw new Error('Invalid MarketMoverAgent config');
    }
  }

  /**
   * Generate price adjustments for events that occurred this tick
   *
   * @param currentPrices - Map of ticker -> current price
   * @param events - World events that occurred this tick
   * @param context - Optional context with affected tickers
   * @returns Map of ticker -> percentage change
   */
  async generatePriceAdjustments(
    currentPrices: Map<string, number>,
    events: WorldEvent[],
    context?: MarketMoverContext
  ): Promise<Map<string, number>> {
    // If no events, no price changes
    if (events.length === 0) {
      return new Map();
    }

    // Sum raw per-event changes per ticker, then clamp once per tick so the
    // result does not depend on event order.
    const rawSums = new Map<string, number>();

    for (const event of events) {
      // Determine which tickers are affected
      const affectedTickers = this.determineAffectedTickers(
        event,
        currentPrices,
        context
      );

      if (affectedTickers.length === 0) {
        continue;
      }

      // Get volatility bucket and direction; neutral/unknown evidence moves nothing
      const eventVolatility = this.getEventVolatility(event);
      if (!eventVolatility) {
        continue;
      }

      // Generate price change for each affected ticker
      for (const ticker of affectedTickers) {
        const percentageChange = this.selectPercentageFromBucket(
          eventVolatility.bucket,
          !eventVolatility.isNegative
        );
        rawSums.set(ticker, (rawSums.get(ticker) ?? 0) + percentageChange);
      }
    }

    const adjustments = new Map<string, number>();
    const limit = this.config.maxPriceChangePerEvent;
    for (const [ticker, sum] of rawSums) {
      adjustments.set(ticker, Math.max(-limit, Math.min(limit, sum)));
    }

    return adjustments;
  }

  /**
   * Determine which tickers are affected by an event
   */
  private determineAffectedTickers(
    event: WorldEvent,
    currentPrices: Map<string, number>,
    context?: MarketMoverContext
  ): string[] {
    // If context specifies affected tickers, use those
    if (context?.affectedTickers && context.affectedTickers.length > 0) {
      return [...new Set(context.affectedTickers)].filter((t) =>
        currentPrices.has(t)
      );
    }

    // Check if event description mentions any tickers as whole tokens
    // (substring matching would let "SOL" match "SOLD").
    const tokens = new Set(
      event.description
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(Boolean)
    );
    const mentionedTickers = Array.from(currentPrices.keys()).filter((ticker) =>
      tokens.has(ticker.toUpperCase())
    );

    if (mentionedTickers.length > 0) {
      return mentionedTickers;
    }

    // No specific ticker identified - return empty (no price change)
    return [];
  }

  /**
   * Get volatility bucket and direction for an event type
   */
  private getEventVolatility(event: WorldEvent): {
    bucket: VolatilityBucket;
    isNegative: boolean;
  } | null {
    // Check if we have a mapping for this event type
    const mapping = EVENT_TYPE_VOLATILITY[event.type];

    // A zero sentiment carries no direction: it never overrides the event
    // type's direction and never implies a positive move on its own.
    const sentiment =
      event.sentimentSignal !== undefined && event.sentimentSignal !== 0
        ? event.sentimentSignal
        : undefined;

    if (mapping) {
      // Use sentiment signal if available to override direction
      if (sentiment !== undefined) {
        return {
          bucket: mapping.bucket,
          isNegative: sentiment < 0,
        };
      }
      return mapping;
    }

    // Default: use sentiment signal if available
    if (sentiment !== undefined) {
      // Map sentiment magnitude to bucket
      const magnitude = Math.abs(sentiment);
      let bucket: VolatilityBucket;
      if (magnitude > 0.7) {
        bucket = 'high';
      } else if (magnitude > 0.4) {
        bucket = 'medium';
      } else {
        bucket = 'low';
      }

      return {
        bucket,
        isNegative: sentiment < 0,
      };
    }

    // Default: low volatility, direction from explicit pointsToward only.
    // With no directional evidence there is no move (never assume positive).
    if (event.pointsToward === 'YES' || event.pointsToward === 'NO') {
      return { bucket: 'low', isNegative: event.pointsToward === 'NO' };
    }
    return null;
  }

  /**
   * Select a percentage change within a volatility bucket using seeded RNG
   */
  private selectPercentageFromBucket(
    bucket: VolatilityBucket,
    isPositive: boolean
  ): number {
    const range = VOLATILITY_BUCKET_RANGES[bucket];
    const magnitude = this.rng.nextFloat(range.min, range.max);
    return isPositive ? magnitude : -magnitude;
  }

  /**
   * Apply price adjustments to current prices, respecting bounds
   *
   * @param currentPrices - Map of ticker -> current price
   * @param adjustments - Map of ticker -> percentage change
   * @param initialPrices - Map of ticker -> initial price (for bounds)
   * @returns Map of ticker -> new price
   */
  applyAdjustments(
    currentPrices: Map<string, number>,
    adjustments: Map<string, number>,
    initialPrices: Map<string, number>
  ): Map<string, number> {
    const newPrices = new Map<string, number>();

    for (const [ticker, currentPrice] of currentPrices) {
      const adjustment = adjustments.get(ticker) ?? 0;
      let newPrice = currentPrice * (1 + adjustment);

      // Apply price bounds based on the canonical initial price; using the
      // current price as a stand-in would silently reset the bounds.
      const initialPrice = initialPrices.get(ticker);
      if (initialPrice === undefined || !(initialPrice > 0)) {
        throw new Error(`Missing initial price for ticker ${ticker}`);
      }
      const minPrice = initialPrice * this.config.minPriceFloor;
      const maxPrice = initialPrice * this.config.maxPriceCeiling;
      newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));

      newPrices.set(ticker, newPrice);
    }

    return newPrices;
  }
}
