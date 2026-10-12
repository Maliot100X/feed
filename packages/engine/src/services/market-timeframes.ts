/**
 * Market Timeframes Service
 *
 * Defines market types with different resolution timeframes, inspired by Polymarket's
 * diverse market durations. Markets range from 15-minute flash markets to multi-month
 * long-term predictions.
 *
 * ## Market Type Hierarchy
 *
 * ```
 * LONG-TERM ARC (30 days - 3 months)
 * └── Main Question: "Will Aipple release the AI Phone this quarter?"
 *     ├── WEEKLY SUB-MARKET (7 days)
 *     │   └── "Will Sim Cook mention AI Phone at WWDC?"
 *     │       ├── DAILY SUB-MARKET (24-48 hours)
 *     │       │   └── "Will Aipple stock close above $180 today?"
 *     │       └── INTRADAY SUB-MARKET (1-6 hours)
 *     │           └── "Will the keynote receive positive initial reception?"
 *     │               └── FLASH MARKET (15-30 minutes)
 *     │                   └── "Will Sim Cook demo a new product in the first 30 min?"
 *     └── WEEKLY SUB-MARKET (7 days)
 *         └── "Will supply chain leaks confirm AI Phone components?"
 * ```
 *
 * ## Timeframe Categories (inspired by Polymarket)
 *
 * 1. **Flash Markets** (15-30 min): Live event betting
 *    - Sports: "Will this drive result in a touchdown?"
 *    - Keynotes: "Will a specific announcement be made?"
 *    - Breaking News: "Will stock move 1% in next 15 min?"
 *
 * 2. **Intraday Markets** (1-6 hours): Same-day resolution
 *    - Market closes: "Will stock close green today?"
 *    - Event outcomes: "What will be announced at the conference?"
 *
 * 3. **Daily Markets** (12-48 hours): Next-day resolution
 *    - Earnings: "Will company beat earnings estimates?"
 *    - News: "Will story develop further tomorrow?"
 *
 * 4. **Weekly Markets** (3-7 days): Short-term trends
 *    - Product launches: "Will launch go smoothly this week?"
 *    - Political: "Will bill pass committee this week?"
 *
 * 5. **Monthly Markets** (2-4 weeks): Medium-term outcomes
 *    - Business: "Will deal close this month?"
 *    - Regulatory: "Will approval be granted this month?"
 *
 * 6. **Quarterly/Long-Term Markets** (1-3+ months): Strategic outcomes
 *    - Product launches: "Will product ship this quarter?"
 *    - Elections: "Who will win the election?"
 *    - Crypto: "Will BTC reach $100k this year?"
 */

import type {
  ArcStateType,
  LongTermArcState,
  MarketCategory,
  MarketTimeframe,
} from '@feed/db';
import { clamp01 } from '../utils/math-utils';

// Re-export types from DB schema for consumers of this module
// Arc state types are canonical in @feed/db/schema/narrative.ts
export type {
  ArcStateType,
  DailyArcState,
  FlashArcState,
  IntradayArcState,
  LongTermArcState,
  MarketCategory,
  MarketTimeframe,
  WeeklyArcState,
} from '@feed/db';

/**
 * Standard arc state alias for weekly/monthly/quarterly markets.
 * These use the same state progression as LongTermArcState but over shorter periods.
 */
export type StandardArcState = LongTermArcState;

/**
 * Configuration for a market timeframe
 */
export interface TimeframeConfig {
  /** Human-readable name */
  name: string;
  /** Minimum duration in minutes */
  minDurationMinutes: number;
  /** Maximum duration in minutes */
  maxDurationMinutes: number;
  /** Default duration in minutes */
  defaultDurationMinutes: number;
  /** Arc states for this timeframe */
  arcStates: string[];
  /** Minimum event cooldown in minutes */
  eventCooldownMinutes: number;
  /** Can spawn child markets? */
  canSpawnChildren: boolean;
  /** Allowed child timeframes */
  childTimeframes: MarketTimeframe[];
  /** NPC posting frequency multiplier */
  postingMultiplier: number;
  /** Event generation probability multiplier */
  eventMultiplier: number;
}

/**
 * Market with timeframe metadata
 */
export interface TimeframedMarket {
  id: string;
  questionId: string;
  timeframe: MarketTimeframe;
  category: MarketCategory;
  parentMarketId?: string;
  startTime: Date;
  endTime: Date;
  arcState: string;
  arcStateEnteredAt: Date;
  childMarketIds: string[];
  metadata?: {
    eventId?: string; // Source event that spawned this
    triggeredBy?: string; // Parent market event
    affiliatedOrgs?: string[];
    affiliatedActors?: string[];
  };
}

// =============================================================================
// GRANULAR TIMEFRAME TO DB TIMEFRAME MAPPING
// =============================================================================

/**
 * Maps granular timeframe strings (like '15m', '30m', '1h') to their
 * corresponding DB timeframe categories ('flash', 'intraday', 'daily', 'weekly').
 *
 * This is the canonical source of truth for this mapping, used by:
 * - markets-tick cron for market creation and tracking
 * - Integration tests for validation
 */
export const GRANULAR_TO_DB_TIMEFRAME: Record<string, MarketTimeframe> = {
  '15m': 'flash',
  '30m': 'flash',
  '1h': 'intraday',
  '6h': 'intraday',
  '12h': 'daily',
  '1d': 'daily',
  '2d': 'weekly',
  '3d': 'weekly',
} as const;

/**
 * Map a granular timeframe string to its DB timeframe category.
 * Throws an error for unknown timeframes to fail fast.
 *
 * @param timeframe - Granular timeframe string (e.g., '15m', '1h', '1d')
 * @returns The corresponding DB timeframe category
 * @throws Error if timeframe is not recognized
 */
export function mapGranularToDbTimeframe(timeframe: string): MarketTimeframe {
  const dbTimeframe = GRANULAR_TO_DB_TIMEFRAME[timeframe];
  if (!dbTimeframe) {
    throw new Error(`Unsupported granular timeframe: ${timeframe}`);
  }
  return dbTimeframe;
}

// =============================================================================
// TIMEFRAME CONFIGURATIONS
// =============================================================================

export const TIMEFRAME_CONFIGS: Record<MarketTimeframe, TimeframeConfig> = {
  flash: {
    name: 'Flash Market',
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
    defaultDurationMinutes: 15,
    arcStates: ['live', 'resolving'],
    eventCooldownMinutes: 2,
    canSpawnChildren: false,
    childTimeframes: [],
    postingMultiplier: 3.0, // Very high activity
    eventMultiplier: 0.5, // Few events, fast resolution
  },

  intraday: {
    name: 'Intraday Market',
    minDurationMinutes: 60, // 1 hour
    maxDurationMinutes: 360, // 6 hours
    defaultDurationMinutes: 180, // 3 hours
    arcStates: ['setup', 'active', 'climax', 'resolution'],
    eventCooldownMinutes: 15,
    canSpawnChildren: true,
    childTimeframes: ['flash'],
    postingMultiplier: 2.0,
    eventMultiplier: 1.0,
  },

  daily: {
    name: 'Daily Market',
    minDurationMinutes: 720, // 12 hours
    maxDurationMinutes: 2880, // 48 hours
    defaultDurationMinutes: 1440, // 24 hours
    arcStates: ['morning', 'midday', 'afternoon', 'evening', 'resolution'],
    eventCooldownMinutes: 30,
    canSpawnChildren: true,
    childTimeframes: ['flash', 'intraday'],
    postingMultiplier: 1.5,
    eventMultiplier: 1.2,
  },

  weekly: {
    name: 'Weekly Market',
    minDurationMinutes: 4320, // 3 days
    maxDurationMinutes: 10080, // 7 days
    defaultDurationMinutes: 7200, // 5 days
    arcStates: ['setup', 'tension', 'escalation', 'crisis', 'resolution'],
    eventCooldownMinutes: 60,
    canSpawnChildren: true,
    childTimeframes: ['flash', 'intraday', 'daily'],
    postingMultiplier: 1.2,
    eventMultiplier: 1.5,
  },

  monthly: {
    name: 'Monthly Market',
    minDurationMinutes: 20160, // 14 days
    maxDurationMinutes: 40320, // 28 days
    defaultDurationMinutes: 30240, // 21 days
    arcStates: [
      'setup',
      'tension',
      'escalation',
      'crisis',
      'revelation',
      'resolution',
    ],
    eventCooldownMinutes: 120, // 2 hours
    canSpawnChildren: true,
    childTimeframes: ['flash', 'intraday', 'daily', 'weekly'],
    postingMultiplier: 1.0,
    eventMultiplier: 1.5,
  },

  quarterly: {
    name: 'Quarterly Market',
    minDurationMinutes: 43200, // 30 days
    maxDurationMinutes: 129600, // 90 days
    defaultDurationMinutes: 64800, // 45 days
    arcStates: [
      'setup',
      'tension',
      'escalation',
      'crisis',
      'revelation',
      'resolution',
    ],
    eventCooldownMinutes: 120,
    canSpawnChildren: true,
    childTimeframes: ['flash', 'intraday', 'daily', 'weekly', 'monthly'],
    postingMultiplier: 1.0,
    eventMultiplier: 2.0,
  },

  longterm: {
    name: 'Long-Term Market',
    minDurationMinutes: 129600, // 90 days
    maxDurationMinutes: 525600, // 365 days
    defaultDurationMinutes: 259200, // 180 days
    arcStates: [
      'setup',
      'tension',
      'escalation',
      'crisis',
      'revelation',
      'resolution',
    ],
    eventCooldownMinutes: 240, // 4 hours
    canSpawnChildren: true,
    childTimeframes: [
      'flash',
      'intraday',
      'daily',
      'weekly',
      'monthly',
      'quarterly',
    ],
    postingMultiplier: 0.8,
    eventMultiplier: 2.5,
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Calculate end time from start and timeframe
 */
export function calculateEndTime(
  startTime: Date,
  timeframe: MarketTimeframe,
  durationModifier = 1.0
): Date {
  const config = TIMEFRAME_CONFIGS[timeframe];
  const durationMinutes = Math.round(
    config.defaultDurationMinutes * durationModifier
  );
  const clampedDuration = Math.max(
    config.minDurationMinutes,
    Math.min(config.maxDurationMinutes, durationMinutes)
  );

  return new Date(startTime.getTime() + clampedDuration * 60 * 1000);
}

/**
 * Get current arc state based on elapsed time.
 *
 * @throws Error if either date is invalid or endTime is not after startTime
 */
export function getCurrentArcState(
  startTime: Date,
  endTime: Date,
  timeframe: MarketTimeframe,
  now: Date = new Date()
): ArcStateType {
  const states = TIMEFRAME_CONFIGS[timeframe].arcStates;
  const firstState = states[0];
  const lastState = states[states.length - 1];
  if (firstState === undefined || lastState === undefined) {
    throw new Error(
      `getCurrentArcState: no arcStates defined for timeframe '${timeframe}'`
    );
  }

  const start = startTime.getTime();
  const end = endTime.getTime();
  const current = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(
      `getCurrentArcState: invalid start/end time for timeframe '${timeframe}'`
    );
  }
  if (!Number.isFinite(current)) {
    throw new Error('getCurrentArcState: invalid current time');
  }
  if (end <= start) {
    throw new Error(
      `getCurrentArcState: endTime must be after startTime for timeframe '${timeframe}'. ` +
        `startTime: ${startTime.toISOString()}, endTime: ${endTime.toISOString()}`
    );
  }

  if (current <= start) {
    return firstState as ArcStateType;
  }
  if (current >= end) {
    return lastState as ArcStateType;
  }

  const progress = clamp01((current - start) / (end - start));
  const stateIndex = Math.min(
    states.length - 1,
    Math.floor(progress * states.length)
  );
  return (states[stateIndex] ?? lastState) as ArcStateType;
}

/**
 * Calculate state phase boundaries for a timeframe
 */
export function getStateBoundaries(
  startTime: Date,
  endTime: Date,
  timeframe: MarketTimeframe
): Array<{ state: string; start: Date; end: Date }> {
  const config = TIMEFRAME_CONFIGS[timeframe];
  const states = config.arcStates;

  // Guard against division by zero when no arc states are defined
  if (states.length === 0) {
    throw new Error(
      `getStateBoundaries: no arcStates defined for timeframe '${timeframe}'`
    );
  }

  const totalDuration = endTime.getTime() - startTime.getTime();

  if (!Number.isFinite(totalDuration)) {
    throw new Error(
      `getStateBoundaries: invalid start/end time for timeframe '${timeframe}'`
    );
  }

  // Guard against invalid time range (endTime must be after startTime)
  if (totalDuration <= 0) {
    throw new Error(
      `getStateBoundaries: endTime must be after startTime for timeframe '${timeframe}'. ` +
        `startTime: ${startTime.toISOString()}, endTime: ${endTime.toISOString()}`
    );
  }

  const phaseDuration = totalDuration / states.length;

  return states.map((state, index) => ({
    state,
    start: new Date(startTime.getTime() + index * phaseDuration),
    end: new Date(startTime.getTime() + (index + 1) * phaseDuration),
  }));
}

/**
 * Get event cooldown for a timeframe
 */
export function getEventCooldownMs(timeframe: MarketTimeframe): number {
  const config = TIMEFRAME_CONFIGS[timeframe];
  return config.eventCooldownMinutes * 60 * 1000;
}

/**
 * Get event multiplier for a timeframe
 */
export function getEventMultiplier(timeframe: MarketTimeframe): number {
  return TIMEFRAME_CONFIGS[timeframe].eventMultiplier;
}
