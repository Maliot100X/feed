/**
 * Daily Login Service
 *
 * Manages daily login rewards and streak tracking (BAB-88).
 * - 24h minimum between claims
 * - 36h grace period before streak resets
 * - Escalating rewards Day 1-7, then cycles
 * - Milestone bonuses at 7, 14, 30, 60, 90 days
 *
 * ## Assumptions
 * - `virtualBalance` is user's spendable balance (rewards can be spent immediately)
 * - `bonusPoints` tracks non-trading rewards (affects leaderboard categorization)
 * - `reputationPoints` also updated for reputation/progression
 * - All timestamps are UTC (no timezone/calendar day logic)
 * - Concurrent claims are serialized by the user row lock (FOR UPDATE)
 */

import {
  balanceTransactions,
  buildDailyLoginRewardBalanceDescription,
  db,
  eq,
  sql,
  users,
} from '@feed/db';
import {
  DAILY_LOGIN,
  generateSnowflakeId,
  isValidSnowflakeId,
  logger,
  POINTS,
} from '@feed/shared';

// ─── Errors ──────────────────────────────────────────────────────────────────

export class UserNotFoundError extends Error {
  readonly code = 'USER_NOT_FOUND' as const;

  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  nextReward: number;
  daysUntilMilestone: number;
  nextMilestone: number;
  lastClaim: Date | null;
  canClaim: boolean;
  timeUntilClaim: number;
  timeUntilReset: number;
  totalDailyLogins: number;
}

export interface ClaimResult {
  success: boolean;
  streak: number;
  reward: number;
  milestoneBonus: number;
  totalAwarded: number;
  nextReward: number;
  daysUntilMilestone: number;
  nextMilestone: number;
  streakReset: boolean;
  error?: string;
}

interface ClaimStatus {
  canClaim: boolean;
  shouldResetStreak: boolean;
  timeUntilClaim: number;
  timeUntilReset: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MILESTONES = [
  { days: 7, bonus: POINTS.DAILY_LOGIN_MILESTONE_7D },
  { days: 14, bonus: POINTS.DAILY_LOGIN_MILESTONE_14D },
  { days: 30, bonus: POINTS.DAILY_LOGIN_MILESTONE_30D },
  { days: 60, bonus: POINTS.DAILY_LOGIN_MILESTONE_60D },
  { days: 90, bonus: POINTS.DAILY_LOGIN_MILESTONE_90D },
] as const;

const DAILY_REWARDS = [
  POINTS.DAILY_LOGIN_DAY_1, // index 0 = Day 1
  POINTS.DAILY_LOGIN_DAY_2,
  POINTS.DAILY_LOGIN_DAY_3,
  POINTS.DAILY_LOGIN_DAY_4,
  POINTS.DAILY_LOGIN_DAY_5,
  POINTS.DAILY_LOGIN_DAY_6,
  POINTS.DAILY_LOGIN_DAY_7,
] as const;

// ─── Helper Functions (exported for testing) ─────────────────────────────────

export function getDailyReward(streakDay: number): number {
  // Math.floor ensures floats like 1.9 are handled predictably (treated as day 1)
  const idx = Math.floor(Math.max(0, streakDay - 1)) % DAILY_LOGIN.CYCLE_LENGTH;
  return DAILY_REWARDS[idx] ?? DAILY_REWARDS[0];
}

export function getMilestoneBonus(streak: number): number {
  return MILESTONES.find((m) => m.days === streak)?.bonus ?? 0;
}

export function getNextMilestone(streak: number): {
  nextMilestone: number;
  daysUntilMilestone: number;
} {
  // Clamp to 0 to handle negative input defensively (e.g., corrupted data)
  const safeStreak = Math.max(0, streak);
  const next = MILESTONES.find((m) => safeStreak < m.days);
  return next
    ? { nextMilestone: next.days, daysUntilMilestone: next.days - safeStreak }
    : { nextMilestone: 0, daysUntilMilestone: 0 };
}

/**
 * Builds a ClaimResult with sensible defaults for error/incomplete cases.
 * Exported for testing purposes.
 */
export function buildClaimResult(
  partial: Partial<ClaimResult> & { streak: number }
): ClaimResult {
  return {
    success: false,
    reward: 0,
    milestoneBonus: 0,
    totalAwarded: 0,
    nextReward: getDailyReward(partial.streak + 1),
    ...getNextMilestone(partial.streak),
    streakReset: false,
    ...partial,
  };
}

export function getClaimStatus(
  lastClaim: Date | null,
  now: number = Date.now()
): ClaimStatus {
  if (!lastClaim) {
    return {
      canClaim: true,
      shouldResetStreak: false,
      timeUntilClaim: 0,
      timeUntilReset: 0,
    };
  }

  // Clamp to 0 to handle clock skew (lastClaim in the future)
  const elapsed = Math.max(0, now - lastClaim.getTime());
  const { MIN_CLAIM_INTERVAL_MS, GRACE_PERIOD_MS } = DAILY_LOGIN;

  if (elapsed < MIN_CLAIM_INTERVAL_MS) {
    return {
      canClaim: false,
      shouldResetStreak: false,
      timeUntilClaim: MIN_CLAIM_INTERVAL_MS - elapsed,
      timeUntilReset: GRACE_PERIOD_MS - elapsed,
    };
  }

  if (elapsed < GRACE_PERIOD_MS) {
    return {
      canClaim: true,
      shouldResetStreak: false,
      timeUntilClaim: 0,
      timeUntilReset: GRACE_PERIOD_MS - elapsed,
    };
  }

  return {
    canClaim: true,
    shouldResetStreak: true,
    timeUntilClaim: 0,
    timeUntilReset: 0,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class DailyLoginService {
  private static validateUserId(userId: string): void {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId: must be a non-empty string');
    }
    // Accept both Snowflake IDs and Privy DIDs (did:privy:...)
    // Some users may have Privy IDs as their database ID
    // Check Privy DID first since isValidSnowflakeId throws on non-numeric strings
    if (userId.startsWith('did:privy:')) {
      return; // Valid Privy DID format
    }
    if (!isValidSnowflakeId(userId)) {
      throw new Error(`Invalid userId format: ${userId}`);
    }
  }

  static async getStreakInfo(userId: string): Promise<StreakInfo> {
    this.validateUserId(userId);

    const [user] = await db
      .select({
        dailyLoginStreak: users.dailyLoginStreak,
        lastDailyLogin: users.lastDailyLogin,
        longestStreak: users.longestStreak,
        totalDailyLogins: users.totalDailyLogins,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new UserNotFoundError(userId);

    const status = getClaimStatus(user.lastDailyLogin);
    const currentStreak = Math.max(0, user.dailyLoginStreak);
    const longestStreak = Math.max(0, user.longestStreak);
    const totalDailyLogins = Math.max(0, user.totalDailyLogins);
    // Use effective streak (0 if expired) for all calculations to avoid
    // inconsistent UI state (e.g., "50 day streak" but "7 days to 7-day milestone")
    const effectiveStreak = status.shouldResetStreak ? 0 : currentStreak;
    const milestone = getNextMilestone(effectiveStreak);

    return {
      currentStreak: effectiveStreak, // Use effective, not raw DB value
      longestStreak,
      nextReward: getDailyReward(effectiveStreak + 1),
      ...milestone,
      lastClaim: user.lastDailyLogin,
      canClaim: status.canClaim,
      timeUntilClaim: status.timeUntilClaim,
      timeUntilReset: status.timeUntilReset,
      totalDailyLogins,
    };
  }

  static async claimDailyReward(userId: string): Promise<ClaimResult> {
    // Validate userId format before querying
    // Accept both Snowflake IDs and Privy DIDs (did:privy:...)
    // Check Privy DID first since isValidSnowflakeId throws on non-numeric strings
    if (!userId || typeof userId !== 'string') {
      return buildClaimResult({ streak: 0, error: 'Invalid userId format' });
    }
    const isPrivyDid = userId.startsWith('did:privy:');
    const isSnowflake = !isPrivyDid && isValidSnowflakeId(userId);
    if (!isPrivyDid && !isSnowflake) {
      return buildClaimResult({ streak: 0, error: 'Invalid userId format' });
    }

    // The user row lock (FOR UPDATE) serializes concurrent claims: the
    // second claim waits, then sees the updated lastDailyLogin and is
    // rejected by the eligibility check.
    const result = await db.transaction(async (tx) => {
      // Read current user state INSIDE transaction with FOR UPDATE lock
      // to prevent concurrent balance mutations between read and update
      const [user] = await tx
        .select({
          dailyLoginStreak: users.dailyLoginStreak,
          lastDailyLogin: users.lastDailyLogin,
          longestStreak: users.longestStreak,
          totalDailyLogins: users.totalDailyLogins,
          virtualBalance: users.virtualBalance,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for('update');

      if (!user) {
        return buildClaimResult({ streak: 0, error: 'User not found' });
      }

      // Check eligibility INSIDE transaction
      const status = getClaimStatus(user.lastDailyLogin);

      if (!status.canClaim) {
        return buildClaimResult({
          streak: Math.max(0, user.dailyLoginStreak),
          error: 'Cannot claim yet - must wait 24 hours between claims',
        });
      }

      // Calculate reward values
      const currentStreak = Math.max(0, user.dailyLoginStreak);
      const newStreak = status.shouldResetStreak ? 1 : currentStreak + 1;
      const reward = getDailyReward(newStreak);
      const milestoneBonus = getMilestoneBonus(newStreak);
      const totalAwarded = reward + milestoneBonus;
      const newLongestStreak = Math.max(user.longestStreak, newStreak);
      const balanceBefore = Number(user.virtualBalance);
      const now = new Date();

      // Update user state
      await tx
        .update(users)
        .set({
          dailyLoginStreak: newStreak,
          lastDailyLogin: now,
          longestStreak: newLongestStreak,
          totalDailyLogins: user.totalDailyLogins + 1,
          virtualBalance: sql`${users.virtualBalance} + ${totalAwarded}`,
          bonusPoints: sql`${users.bonusPoints} + ${totalAwarded}`,
          reputationPoints: sql`${users.reputationPoints} + ${totalAwarded}`,
          updatedAt: now,
        })
        .where(eq(users.id, userId));

      // Record transaction
      await tx.insert(balanceTransactions).values({
        id: await generateSnowflakeId(),
        userId,
        type: 'deposit',
        amount: totalAwarded.toString(),
        balanceBefore: balanceBefore.toString(),
        balanceAfter: (balanceBefore + totalAwarded).toString(),
        description: buildDailyLoginRewardBalanceDescription(
          newStreak,
          milestoneBonus
        ),
      });

      return {
        success: true,
        streak: newStreak,
        reward,
        milestoneBonus,
        totalAwarded,
        nextReward: getDailyReward(newStreak + 1),
        ...getNextMilestone(newStreak),
        streakReset: status.shouldResetStreak,
      };
    });

    if (result.success) {
      logger.info(
        'Daily login claimed',
        {
          userId,
          newStreak: result.streak,
          reward: result.reward,
          milestoneBonus: result.milestoneBonus,
          totalAwarded: result.totalAwarded,
          streakReset: result.streakReset,
        },
        'DailyLoginService'
      );
    }

    return result;
  }
}
