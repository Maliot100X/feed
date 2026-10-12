/**
 * Feed Diversity Utilities
 *
 * Mechanisms for preventing action clustering in generated feed activity.
 *
 * Exports:
 * - shuffleWithNoConsecutive: randomized ordering avoiding adjacent duplicates
 * - createDiscourseActionDeck: Stratified action deck for quote/reply ratios
 * - ActionDiversityTracker: Tracks recent actions to prevent clustering
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Action types tracked by the diversity system for social engagement.
 */
export type EngagementActionType = 'like' | 'share' | 'comment';

/**
 * Action types for discourse generation (quotes vs replies).
 */
export type DiscourseActionType = 'quote' | 'reply';

// =============================================================================
// SHUFFLE WITH NO CONSECUTIVE
// =============================================================================

/**
 * Randomized ordering that avoids placing equal values next to each other.
 *
 * Built one element at a time. A candidate is "safe" when, after placing it,
 * the remaining items can still be arranged with no adjacent duplicates
 * given that the next item must differ from it:
 *   - the picked value's remaining count <= floor(n / 2)
 *   - every other value's remaining count <= ceil(n / 2)
 * where n is the number of items left after the pick.
 *
 * When no adjacent-free arrangement exists (e.g. a deck dominated by one
 * value) the requested multiset is preserved and the function returns the
 * best achievable arrangement by greedily placing the most frequent value
 * that differs from the previous item.
 *
 * @param arr Array to order
 * @param random RNG function returning [0, 1)
 */
export function shuffleWithNoConsecutive<T>(
  arr: T[],
  random: () => number
): T[] {
  if (arr.length <= 1) return [...arr];

  const result: T[] = [];
  const remaining = [...arr];

  const countByValue = new Map<T, number>();
  for (const item of remaining) {
    countByValue.set(item, (countByValue.get(item) ?? 0) + 1);
  }

  const isSafePick = (value: T): boolean => {
    const n = remaining.length - 1;
    if (n === 0) return true;
    for (const [v, count] of countByValue) {
      if (v === value) {
        if (count - 1 > Math.floor(n / 2)) return false;
      } else if (count > Math.ceil(n / 2)) {
        return false;
      }
    }
    return true;
  };

  while (remaining.length > 0) {
    const hasLast = result.length > 0;
    const lastItem = result[result.length - 1];

    const validIndices: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (!hasLast || remaining[i] !== lastItem) validIndices.push(i);
    }

    const safeIndices = validIndices.filter((idx) =>
      isSafePick(remaining[idx]!)
    );

    let candidates: number[];
    if (safeIndices.length > 0) {
      candidates = safeIndices;
    } else if (validIndices.length > 0) {
      // No adjacent-free completion exists: place the most frequent value
      // that still differs from the previous item.
      let best = 0;
      for (const idx of validIndices) {
        best = Math.max(best, countByValue.get(remaining[idx]!) ?? 0);
      }
      candidates = validIndices.filter(
        (idx) => (countByValue.get(remaining[idx]!) ?? 0) === best
      );
    } else {
      candidates = remaining.map((_, idx) => idx);
    }

    const pickIdx = candidates[Math.floor(random() * candidates.length)]!;
    const pickedValue = remaining[pickIdx]!;
    result.push(pickedValue);

    countByValue.set(pickedValue, (countByValue.get(pickedValue) ?? 1) - 1);
    remaining.splice(pickIdx, 1);
  }

  return result;
}

// =============================================================================
// DISCOURSE ACTION DECK
// =============================================================================

/**
 * Creates a stratified action deck with exact ratios, ordered to avoid two
 * identical actions in a row whenever the ratio makes that possible.
 *
 * Instead of rolling `random() < probability` for each action (which can cluster),
 * we pre-define action slots with guaranteed ratios and shuffle with constraints.
 *
 * @param totalSlots Total actions to perform
 * @param quoteRatio Target ratio of quote posts (e.g., 0.30)
 * @param random RNG function for shuffling
 */
export function createDiscourseActionDeck(
  totalSlots: number,
  quoteRatio: number,
  random: () => number
): DiscourseActionType[] {
  if (!Number.isSafeInteger(totalSlots) || totalSlots < 0) {
    throw new Error(
      `totalSlots must be a non-negative integer, got ${totalSlots}`
    );
  }
  if (!Number.isFinite(quoteRatio)) {
    throw new Error(`quoteRatio must be finite, got ${quoteRatio}`);
  }
  if (totalSlots === 0) return [];

  // Clamp quoteRatio to valid [0, 1] range to prevent negative/oversized counts
  const clampedRatio = Math.max(0, Math.min(1, quoteRatio));
  const quoteCount = Math.round(totalSlots * clampedRatio);
  const replyCount = totalSlots - quoteCount;

  // Build deck with exact ratios
  const deck: DiscourseActionType[] = [
    ...Array(quoteCount).fill('quote' as const),
    ...Array(replyCount).fill('reply' as const),
  ];

  // Order with no 2 same in a row when the ratio allows it
  return shuffleWithNoConsecutive(deck, random);
}

// =============================================================================
// ACTION DIVERSITY TRACKER
// =============================================================================

/**
 * Tracks recent action types to prevent clustering.
 *
 * This tracker maintains a rolling buffer of recent actions and checks
 * whether adding a new action would create too many consecutive same types.
 *
 * NOTE: When shouldSkipForDiversity returns true, the action is skipped entirely.
 * This is intentional - we prioritize feed variety over raw engagement counts.
 * If metrics show significant drops, consider implementing action type fallback
 * (try different action when blocked for diversity).
 */
export class ActionDiversityTracker {
  private recentActions: EngagementActionType[] = [];
  private readonly maxRecent: number;
  private readonly maxConsecutive: number;

  /**
   * @param maxRecent Number of recent actions to track in the buffer
   * @param maxConsecutive Maximum consecutive same action type allowed
   */
  constructor(maxRecent = 5, maxConsecutive = 2) {
    if (
      !Number.isSafeInteger(maxRecent) ||
      !Number.isSafeInteger(maxConsecutive)
    ) {
      throw new Error('ActionDiversityTracker limits must be integers');
    }
    // Ensure maxConsecutive is at least 1, then size the buffer from the
    // effective value so the consecutive check always has enough history.
    this.maxConsecutive = Math.max(1, maxConsecutive);
    this.maxRecent = Math.max(maxRecent, this.maxConsecutive);
  }

  /**
   * Record an action that was executed.
   */
  recordAction(type: EngagementActionType): void {
    this.recentActions.push(type);
    if (this.recentActions.length > this.maxRecent) {
      this.recentActions.shift();
    }
  }

  /**
   * Check if executing this action type would create too many consecutive same types.
   * Returns true if the action should be skipped/deferred for diversity.
   */
  shouldSkipForDiversity(type: EngagementActionType): boolean {
    const lastN = this.recentActions.slice(-this.maxConsecutive);
    return (
      lastN.length >= this.maxConsecutive && lastN.every((t) => t === type)
    );
  }

  /**
   * Get the distribution of recent actions for logging.
   */
  getDistribution(): Record<EngagementActionType, number> {
    const dist: Record<EngagementActionType, number> = {
      like: 0,
      share: 0,
      comment: 0,
    };
    for (const action of this.recentActions) {
      dist[action]++;
    }
    return dist;
  }
}
