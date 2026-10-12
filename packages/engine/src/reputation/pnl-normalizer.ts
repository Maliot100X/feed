/**
 * PNL Normalization Utilities
 *
 * Converts profit/loss values to normalized 0-1 scale for reputation scoring.
 * Uses sigmoid function to map unbounded ROI to bounded reputation score.
 */

import { clamp01 } from '../utils/math-utils';

/**
 * Interface for decimal-like values that can be converted to numbers.
 * Used to accept both native numbers and Decimal objects from the database.
 * Defined locally to avoid importing from @feed/db in client-safe code.
 */
interface DecimalLike {
  toNumber(): number;
}

/**
 * Normalize PNL to 0-1 scale using sigmoid function
 *
 * The sigmoid function converts unbounded ROI (as a ratio) to a 0-1 scale:
 * - ROI = 0% → 0.5 (neutral)
 * - ROI = +100% → ~0.73
 * - ROI = -50% → ~0.38
 * - ROI = +200% → ~0.88
 * - ROI = -75% → ~0.32
 *
 * Formula: 1 / (1 + e^(-roi))
 *
 * @throws Error if either input is not a finite number
 *
 * @param pnl - Profit or loss amount (can be negative)
 * @param totalInvested - Total amount invested
 * @returns Normalized score from 0 to 1
 */
export function normalizePnL(
  pnl: number | DecimalLike,
  totalInvested: number | DecimalLike
): number {
  const pnlNum = typeof pnl === 'number' ? pnl : pnl.toNumber();
  const investedNum =
    typeof totalInvested === 'number'
      ? totalInvested
      : totalInvested.toNumber();

  if (!Number.isFinite(pnlNum) || !Number.isFinite(investedNum)) {
    throw new Error('normalizePnL requires finite pnl and totalInvested');
  }

  // Handle edge cases
  if (investedNum === 0) {
    return 0.5; // Neutral score if no investment
  }

  if (pnlNum === 0) {
    return 0.5; // Break-even = neutral
  }

  // Calculate ROI (return on investment)
  const roi = pnlNum / investedNum;

  // Apply sigmoid normalization
  // e^(-roi) for negative ROI dampening
  const normalized = 1 / (1 + Math.exp(-roi));

  // Clamp to [0, 1] range (should already be in range, but safety check)
  return clamp01(normalized);
}

/**
 * Calculate win rate from trading history
 *
 * @param profitableTrades - Number of profitable trades
 * @param totalTrades - Total number of trades
 * @returns Win rate as decimal (0-1)
 */
export function calculateWinRate(
  profitableTrades: number,
  totalTrades: number
): number {
  if (totalTrades === 0) {
    return 0;
  }

  return profitableTrades / totalTrades;
}

/**
 * Get trust level classification from reputation score
 *
 * @param reputationScore - Composite reputation score (0-100)
 * @returns Trust level string
 */
export function getTrustLevel(reputationScore: number): string {
  // Non-finite scores (e.g. NaN from bad inputs) are never rated.
  if (!Number.isFinite(reputationScore)) return 'UNRATED';
  if (reputationScore < 20) return 'UNRATED';
  if (reputationScore < 40) return 'LOW';
  if (reputationScore < 60) return 'MEDIUM';
  if (reputationScore < 80) return 'HIGH';
  return 'EXCELLENT';
}

/**
 * Calculate confidence score based on sample size
 *
 * Uses an exponential saturation curve (1 - e^(-n/20)), not a Wilson
 * interval. More data = higher confidence.
 *
 * @param sampleSize - Number of feedback/trades used for score
 * @returns Confidence score (0-1), where 1 = highly confident
 */
export function calculateConfidenceScore(sampleSize: number): number {
  // Asymptotically approaches 1 as sample size grows
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
    return 0;
  }

  // Confidence formula: 1 - e^(-samples/20)
  // Reaches ~50% confidence at 14 samples
  // Reaches ~75% confidence at 28 samples
  // Reaches ~90% confidence at 46 samples
  const confidence = 1 - Math.exp(-sampleSize / 20);

  return clamp01(confidence);
}
