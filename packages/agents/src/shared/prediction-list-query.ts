/**
 * Shared filter/limit handling for the CHECK_PREDICTIONS list actions
 * (agent-core and user-core).
 */

import { and, eq, gte, markets, type SQL } from '@feed/db';

export type PredictionStatusFilter = 'active' | 'resolved' | 'all';

const STATUS_FILTERS: readonly PredictionStatusFilter[] = [
  'active',
  'resolved',
  'all',
];

export const DEFAULT_PREDICTION_LIST_LIMIT = 10;
export const MAX_PREDICTION_LIST_LIMIT = 20;

/** Missing status means 'active'; anything else must be a known filter. */
export function parsePredictionStatus(
  raw: unknown
): PredictionStatusFilter | null {
  if (raw === undefined || raw === null) return 'active';
  return STATUS_FILTERS.find((s) => s === raw) ?? null;
}

/**
 * Missing limit uses the default; otherwise it must be a finite integer and
 * (integer strings accepted, since LLM params are often strings) and is
 * clamped to [1, MAX]. Returns null for invalid input (NaN, fractions,
 * non-numbers) instead of silently producing an empty result.
 */
export function parsePredictionListLimit(raw: unknown): number | null {
  if (raw === undefined || raw === null) return DEFAULT_PREDICTION_LIST_LIMIT;
  const value =
    typeof raw === 'string' && /^-?\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : raw;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return Math.min(Math.max(value, 1), MAX_PREDICTION_LIST_LIMIT);
}

/**
 * Single combined WHERE condition for a status filter. Drizzle's `.where()`
 * replaces any previous predicate, so conditions must be combined with
 * `and()` rather than chained.
 */
export function predictionStatusCondition(
  status: PredictionStatusFilter,
  now: Date
): SQL | undefined {
  if (status === 'active') {
    return and(eq(markets.resolved, false), gte(markets.endDate, now));
  }
  if (status === 'resolved') {
    return eq(markets.resolved, true);
  }
  return undefined;
}
