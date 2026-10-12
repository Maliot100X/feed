/**
 * Runtime Configuration - Centralized, typed environment config.
 */

import { logger } from '@feed/shared';

/**
 * Read a positive, finite numeric env var. Unset/blank uses the default;
 * zero, negative, non-numeric or non-finite values warn and use the default
 * (previously `Number(v) || default` accepted negatives and Infinity).
 */
function envPositiveNumber(key: string, defaultValue: number): number {
  const raw = process.env[key]?.trim();
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(
      `${key}=${raw} must be a positive finite number, using default ${defaultValue}`,
      { key, value: raw, defaultValue },
      'runtime-config'
    );
    return defaultValue;
  }
  return parsed;
}

/** Boolean flag: accepts "true"/"1" (case-insensitive), like the trade executor. */
function envFlag(key: string): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

const DEFAULT_BUDGET_MS = 180000;
const DEFAULT_RESERVE_MS = 60000;

// Parse budgetMs once to avoid re-reading process.env in getters. The budget
// must leave room for the critical-ops reserve, otherwise the content
// deadline would precede the tick start.
const configuredBudgetMs = envPositiveNumber(
  'GAME_TICK_BUDGET_MS',
  DEFAULT_BUDGET_MS
);
const budgetMs =
  configuredBudgetMs > DEFAULT_RESERVE_MS
    ? configuredBudgetMs
    : (() => {
        logger.warn(
          `GAME_TICK_BUDGET_MS=${configuredBudgetMs} must exceed the ${DEFAULT_RESERVE_MS}ms critical-ops reserve, using default ${DEFAULT_BUDGET_MS}`,
          { configuredBudgetMs, reserveMs: DEFAULT_RESERVE_MS },
          'runtime-config'
        );
        return DEFAULT_BUDGET_MS;
      })();

export const GAME_TICK_CONFIG = {
  budgetMs,
  criticalOpsReserveMs: DEFAULT_RESERVE_MS,
  getContentDeadline: (startedAt: number) =>
    startedAt + budgetMs - DEFAULT_RESERVE_MS,
  getDeadline: (startedAt: number) => startedAt + budgetMs,
} as const;

export const MARKET_DECISION_CONFIG = {
  model: process.env.MARKET_DECISION_MODEL || 'openai/gpt-oss-120b',
  maxOutputTokens: envPositiveNumber(
    'MARKET_DECISION_MAX_OUTPUT_TOKENS',
    32000
  ),
  strictValidation: envFlag('STRICT_LLM_VALIDATION'),
} as const;

// Parse values once to avoid re-reading process.env
const updateIntervalHours = envPositiveNumber(
  'WORLD_FACTS_UPDATE_INTERVAL_HOURS',
  8
);
const lockDurationMinutes = envPositiveNumber(
  'WORLD_FACTS_LOCK_DURATION_MINUTES',
  30
);

export const WORLD_FACTS_CONFIG = {
  updateIntervalHours,
  updateIntervalMs: updateIntervalHours * 3600000,
  lockDurationMinutes,
  lockDurationMs: lockDurationMinutes * 60000,
} as const;

// Cache deployer private key once to avoid re-reading process.env
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

export const BLOCKCHAIN_CONFIG = {
  deployerPrivateKey,
  isConfigured: () => !!deployerPrivateKey,
} as const;

// Cache nodeEnv and bunEnv once and derive all flags from cached values
const nodeEnv = process.env.NODE_ENV || 'development';
const bunEnv = process.env.BUN_ENV;

export const ENV_CONFIG = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test' || bunEnv === 'test',
  isDevelopment: nodeEnv === 'development',
} as const;

/**
 * Sub-market configuration for controlling market spawning behavior.
 * Event-based spawning is disabled by default - markets are created via the cron job.
 * Enable event-based spawning for more dynamic market creation during gameplay.
 */
export const SUB_MARKET_CONFIG = {
  /** Enable event-based sub-market spawning (in addition to cron-based) */
  enableEventBasedSpawning:
    process.env.ENABLE_EVENT_BASED_SUB_MARKETS === 'true',
} as const;

export function hasTimeRemaining(deadline: number): boolean {
  return Date.now() < deadline;
}

export function getTimeRemaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

export function createDeadline(budgetMs: number): number {
  return Date.now() + budgetMs;
}

export const RUNTIME_CONFIG = {
  gameTick: GAME_TICK_CONFIG,
  marketDecision: MARKET_DECISION_CONFIG,
  worldFacts: WORLD_FACTS_CONFIG,
  blockchain: BLOCKCHAIN_CONFIG,
  env: ENV_CONFIG,
  subMarket: SUB_MARKET_CONFIG,
} as const;
