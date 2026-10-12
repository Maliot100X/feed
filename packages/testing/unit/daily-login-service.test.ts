/**
 * Daily Login Service - Comprehensive Unit Tests
 *
 * Exercises the exported pure helpers of daily-login-service.ts directly.
 *
 * Covers:
 * - Boundary conditions at exact timing thresholds
 * - Invalid/edge case inputs
 * - Numeric overflow and extreme values
 * - State transition correctness
 */

import { describe, expect, test } from 'bun:test';
import { DAILY_LOGIN, POINTS } from '@feed/shared';
import {
  getDailyReward,
  getMilestoneBonus,
  getNextMilestone,
  getClaimStatus as serviceGetClaimStatus,
} from '../../api/src/services/daily-login-service';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SECOND = 1_000;

const MILESTONES = [
  { days: 7, bonus: POINTS.DAILY_LOGIN_MILESTONE_7D },
  { days: 14, bonus: POINTS.DAILY_LOGIN_MILESTONE_14D },
  { days: 30, bonus: POINTS.DAILY_LOGIN_MILESTONE_30D },
  { days: 60, bonus: POINTS.DAILY_LOGIN_MILESTONE_60D },
  { days: 90, bonus: POINTS.DAILY_LOGIN_MILESTONE_90D },
] as const;

const DAILY_REWARDS = [
  POINTS.DAILY_LOGIN_DAY_1,
  POINTS.DAILY_LOGIN_DAY_2,
  POINTS.DAILY_LOGIN_DAY_3,
  POINTS.DAILY_LOGIN_DAY_4,
  POINTS.DAILY_LOGIN_DAY_5,
  POINTS.DAILY_LOGIN_DAY_6,
  POINTS.DAILY_LOGIN_DAY_7,
] as const;

/** Adapter: these tests express the last claim as epoch milliseconds. */
function getClaimStatus(lastClaimMs: number | null, now: number = Date.now()) {
  return serviceGetClaimStatus(
    lastClaimMs === null ? null : new Date(lastClaimMs),
    now
  );
}

// ─── Constants Tests ─────────────────────────────────────────────────────────

describe('Daily Login - Constants Validation', () => {
  test('timing constants are positive and correctly ordered', () => {
    expect(DAILY_LOGIN.MIN_CLAIM_INTERVAL_MS).toBe(24 * HOUR);
    expect(DAILY_LOGIN.GRACE_PERIOD_MS).toBe(36 * HOUR);
    expect(DAILY_LOGIN.GRACE_PERIOD_MS).toBeGreaterThan(
      DAILY_LOGIN.MIN_CLAIM_INTERVAL_MS
    );
    expect(DAILY_LOGIN.CYCLE_LENGTH).toBe(7);
  });

  test('reward values are all positive integers', () => {
    for (let i = 1; i <= 7; i++) {
      const key = `DAILY_LOGIN_DAY_${i}` as keyof typeof POINTS;
      expect(POINTS[key]).toBeGreaterThan(0);
      expect(Number.isInteger(POINTS[key])).toBe(true);
    }
  });

  test('rewards strictly increase each day', () => {
    for (let i = 1; i < 7; i++) {
      const curr = `DAILY_LOGIN_DAY_${i}` as keyof typeof POINTS;
      const next = `DAILY_LOGIN_DAY_${i + 1}` as keyof typeof POINTS;
      expect(POINTS[next]).toBeGreaterThan(POINTS[curr]);
    }
  });

  test('milestones are in ascending order with increasing bonuses', () => {
    for (let i = 0; i < MILESTONES.length - 1; i++) {
      const current = MILESTONES[i];
      const next = MILESTONES[i + 1];
      if (current && next) {
        expect(next.days).toBeGreaterThan(current.days);
        expect(next.bonus).toBeGreaterThan(current.bonus);
      }
    }
  });
});

// ─── getDailyReward Tests ────────────────────────────────────────────────────

describe('Daily Login - getDailyReward', () => {
  describe('valid inputs', () => {
    test('days 1-7 return correct escalating rewards', () => {
      expect(getDailyReward(1)).toBe(50);
      expect(getDailyReward(2)).toBe(75);
      expect(getDailyReward(3)).toBe(100);
      expect(getDailyReward(4)).toBe(125);
      expect(getDailyReward(5)).toBe(150);
      expect(getDailyReward(6)).toBe(175);
      expect(getDailyReward(7)).toBe(200);
    });

    test('day 8 cycles back to day 1 reward', () => {
      expect(getDailyReward(8)).toBe(getDailyReward(1));
    });

    test('full cycle verification (days 1-14)', () => {
      for (let day = 1; day <= 14; day++) {
        const expectedIdx = (day - 1) % 7;
        const expected =
          DAILY_REWARDS[expectedIdx as 0 | 1 | 2 | 3 | 4 | 5 | 6];
        expect(getDailyReward(day)).toBe(expected);
      }
    });
  });

  describe('boundary conditions', () => {
    test('day 0 returns day 1 reward (graceful handling)', () => {
      expect(getDailyReward(0)).toBe(DAILY_REWARDS[0]);
    });

    test('negative days return day 1 reward', () => {
      expect(getDailyReward(-1)).toBe(DAILY_REWARDS[0]);
      expect(getDailyReward(-100)).toBe(DAILY_REWARDS[0]);
      expect(getDailyReward(-Number.MAX_SAFE_INTEGER)).toBe(DAILY_REWARDS[0]);
    });

    test('exactly on cycle boundaries', () => {
      expect(getDailyReward(7)).toBe(200); // End of cycle 1
      expect(getDailyReward(8)).toBe(50); // Start of cycle 2
      expect(getDailyReward(14)).toBe(200); // End of cycle 2
      expect(getDailyReward(15)).toBe(50); // Start of cycle 3
    });
  });

  describe('extreme values', () => {
    test('very large streak values cycle correctly', () => {
      // Type assertion needed since modulo result is always 0-6 but TS doesn't infer this
      type RewardIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6;
      expect(getDailyReward(100)).toBe(
        DAILY_REWARDS[((100 - 1) % 7) as RewardIdx]
      );
      expect(getDailyReward(365)).toBe(
        DAILY_REWARDS[((365 - 1) % 7) as RewardIdx]
      );
      expect(getDailyReward(1000)).toBe(
        DAILY_REWARDS[((1000 - 1) % 7) as RewardIdx]
      );
      expect(getDailyReward(10000)).toBe(
        DAILY_REWARDS[((10000 - 1) % 7) as RewardIdx]
      );
    });

    test('MAX_SAFE_INTEGER cycles correctly without overflow', () => {
      const result = getDailyReward(Number.MAX_SAFE_INTEGER);
      const validRewards: number[] = [...DAILY_REWARDS];
      expect(validRewards.includes(result)).toBe(true);
    });
  });

  describe('type coercion edge cases', () => {
    test('floating point days are floored to integer day', () => {
      // Math.floor ensures floats are handled predictably
      // 1.9 → floor(1.9 - 1) = floor(0.9) = 0 → DAILY_REWARDS[0] = Day 1
      expect(getDailyReward(1.9)).toBe(DAILY_REWARDS[0]);
      // 7.999 → floor(7.999 - 1) = floor(6.999) = 6 → DAILY_REWARDS[6] = Day 7
      expect(getDailyReward(7.999)).toBe(DAILY_REWARDS[6]);
    });
  });
});

// ─── getMilestoneBonus Tests ─────────────────────────────────────────────────

describe('Daily Login - getMilestoneBonus', () => {
  describe('exact milestone days', () => {
    test.each([
      [7, 500],
      [14, 750],
      [30, 1500],
      [60, 3000],
      [90, 5000],
    ])('day %i returns bonus %i', (day, expected) => {
      expect(getMilestoneBonus(day)).toBe(expected);
    });
  });

  describe('non-milestone days', () => {
    test('day 1 through 6 return 0', () => {
      for (let day = 1; day <= 6; day++) {
        expect(getMilestoneBonus(day)).toBe(0);
      }
    });

    test('days just before milestones return 0', () => {
      expect(getMilestoneBonus(6)).toBe(0);
      expect(getMilestoneBonus(13)).toBe(0);
      expect(getMilestoneBonus(29)).toBe(0);
      expect(getMilestoneBonus(59)).toBe(0);
      expect(getMilestoneBonus(89)).toBe(0);
    });

    test('days just after milestones return 0', () => {
      expect(getMilestoneBonus(8)).toBe(0);
      expect(getMilestoneBonus(15)).toBe(0);
      expect(getMilestoneBonus(31)).toBe(0);
      expect(getMilestoneBonus(61)).toBe(0);
      expect(getMilestoneBonus(91)).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('day 0 returns 0', () => {
      expect(getMilestoneBonus(0)).toBe(0);
    });

    test('negative days return 0', () => {
      expect(getMilestoneBonus(-1)).toBe(0);
      expect(getMilestoneBonus(-7)).toBe(0);
    });

    test('days beyond last milestone return 0', () => {
      expect(getMilestoneBonus(100)).toBe(0);
      expect(getMilestoneBonus(180)).toBe(0);
      expect(getMilestoneBonus(365)).toBe(0);
    });
  });
});

// ─── getNextMilestone Tests ──────────────────────────────────────────────────

describe('Daily Login - getNextMilestone', () => {
  describe('progression through milestones', () => {
    test('streak 0 targets day 7', () => {
      expect(getNextMilestone(0)).toEqual({
        nextMilestone: 7,
        daysUntilMilestone: 7,
      });
    });

    test('streak 1-6 all target day 7', () => {
      for (let streak = 1; streak <= 6; streak++) {
        expect(getNextMilestone(streak)).toEqual({
          nextMilestone: 7,
          daysUntilMilestone: 7 - streak,
        });
      }
    });

    test('streak 7 targets day 14', () => {
      expect(getNextMilestone(7)).toEqual({
        nextMilestone: 14,
        daysUntilMilestone: 7,
      });
    });

    test('each milestone advances to next', () => {
      expect(getNextMilestone(14)).toEqual({
        nextMilestone: 30,
        daysUntilMilestone: 16,
      });
      expect(getNextMilestone(30)).toEqual({
        nextMilestone: 60,
        daysUntilMilestone: 30,
      });
      expect(getNextMilestone(60)).toEqual({
        nextMilestone: 90,
        daysUntilMilestone: 30,
      });
    });
  });

  describe('after all milestones', () => {
    test('streak 90 returns zeros (all achieved)', () => {
      expect(getNextMilestone(90)).toEqual({
        nextMilestone: 0,
        daysUntilMilestone: 0,
      });
    });

    test('streaks beyond 90 return zeros', () => {
      expect(getNextMilestone(91)).toEqual({
        nextMilestone: 0,
        daysUntilMilestone: 0,
      });
      expect(getNextMilestone(100)).toEqual({
        nextMilestone: 0,
        daysUntilMilestone: 0,
      });
      expect(getNextMilestone(365)).toEqual({
        nextMilestone: 0,
        daysUntilMilestone: 0,
      });
    });
  });

  describe('edge cases', () => {
    test('negative streaks treated as 0', () => {
      // Negative streaks are clamped to 0, so daysUntilMilestone is 7 - 0 = 7
      expect(getNextMilestone(-1)).toEqual({
        nextMilestone: 7,
        daysUntilMilestone: 7,
      });
      expect(getNextMilestone(-100)).toEqual({
        nextMilestone: 7,
        daysUntilMilestone: 7,
      });
    });
  });
});

// ─── getClaimStatus Tests ────────────────────────────────────────────────────

describe('Daily Login - getClaimStatus', () => {
  // Use a fixed timestamp for deterministic tests
  const NOW = 1700000000000; // Fixed "now" for all tests

  describe('first-time user (null lastClaim)', () => {
    test('can claim immediately with no reset', () => {
      const status = getClaimStatus(null, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(false);
      expect(status.timeUntilClaim).toBe(0);
      expect(status.timeUntilReset).toBe(0);
    });
  });

  describe('within 24h window (cannot claim)', () => {
    test('1 second ago - cannot claim', () => {
      const status = getClaimStatus(NOW - SECOND, NOW);
      expect(status.canClaim).toBe(false);
      expect(status.shouldResetStreak).toBe(false);
      expect(status.timeUntilClaim).toBe(24 * HOUR - SECOND);
    });

    test('1 hour ago - cannot claim', () => {
      const status = getClaimStatus(NOW - HOUR, NOW);
      expect(status.canClaim).toBe(false);
      expect(status.timeUntilClaim).toBe(23 * HOUR);
    });

    test('23 hours 59 minutes ago - still cannot claim', () => {
      const status = getClaimStatus(NOW - (24 * HOUR - MINUTE), NOW);
      expect(status.canClaim).toBe(false);
      expect(status.timeUntilClaim).toBe(MINUTE);
    });
  });

  describe('exact 24h boundary', () => {
    test('exactly 24h ago - can claim, streak continues', () => {
      const status = getClaimStatus(NOW - 24 * HOUR, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(false);
      expect(status.timeUntilClaim).toBe(0);
      expect(status.timeUntilReset).toBe(12 * HOUR);
    });

    test('24h + 1ms ago - can claim, streak continues', () => {
      const status = getClaimStatus(NOW - (24 * HOUR + 1), NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(false);
    });
  });

  describe('grace period (24-36h) - can claim, streak continues', () => {
    test('25 hours ago', () => {
      const status = getClaimStatus(NOW - 25 * HOUR, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(false);
      expect(status.timeUntilReset).toBe(11 * HOUR);
    });

    test('30 hours ago', () => {
      const status = getClaimStatus(NOW - 30 * HOUR, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(false);
      expect(status.timeUntilReset).toBe(6 * HOUR);
    });

    test('35 hours 59 minutes ago - barely within grace', () => {
      const status = getClaimStatus(NOW - (36 * HOUR - MINUTE), NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(false);
      expect(status.timeUntilReset).toBe(MINUTE);
    });
  });

  describe('exact 36h boundary (grace period expires)', () => {
    test('exactly 36h ago - streak resets', () => {
      const status = getClaimStatus(NOW - 36 * HOUR, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(true);
      expect(status.timeUntilReset).toBe(0);
    });

    test('36h + 1ms ago - streak resets', () => {
      const status = getClaimStatus(NOW - (36 * HOUR + 1), NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(true);
    });
  });

  describe('long absence - streak resets', () => {
    test('48 hours ago', () => {
      const status = getClaimStatus(NOW - 48 * HOUR, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(true);
    });

    test('1 week ago', () => {
      const status = getClaimStatus(NOW - 7 * 24 * HOUR, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(true);
    });

    test('1 year ago', () => {
      const status = getClaimStatus(NOW - 365 * 24 * HOUR, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('future lastClaim (clock skew) - elapsed clamped to 0, cannot claim', () => {
      // With elapsed clamped to 0, this means timeUntilClaim = 24h
      const status = getClaimStatus(NOW + HOUR, NOW);
      expect(status.canClaim).toBe(false);
      expect(status.timeUntilClaim).toBe(24 * HOUR);
    });

    test('lastClaim at epoch (very old) - streak resets', () => {
      const status = getClaimStatus(0, NOW);
      expect(status.canClaim).toBe(true);
      expect(status.shouldResetStreak).toBe(true);
    });
  });
});

// ─── Total Points Calculation Tests ──────────────────────────────────────────

describe('Daily Login - Total Points Calculation', () => {
  test('day 7 includes both daily reward and milestone bonus', () => {
    const reward = getDailyReward(7);
    const bonus = getMilestoneBonus(7);
    expect(reward).toBe(200);
    expect(bonus).toBe(500);
    expect(reward + bonus).toBe(700);
  });

  test('cumulative points for first 7 days', () => {
    let total = 0;
    for (let day = 1; day <= 7; day++) {
      total += getDailyReward(day) + getMilestoneBonus(day);
    }
    // Days 1-7: 50+75+100+125+150+175+200 = 875
    // Milestone day 7: 500
    // Total: 1375
    expect(total).toBe(1375);
  });

  test('cumulative points for 30 days', () => {
    let total = 0;
    for (let day = 1; day <= 30; day++) {
      total += getDailyReward(day) + getMilestoneBonus(day);
    }
    // Daily rewards: 4 full cycles (28 days) = 4 * 875 = 3500, + days 29-30 = 50+75 = 125 → 3625
    // Milestones: 500 + 750 + 1500 = 2750
    // Total: 6375
    expect(total).toBe(6375);
  });

  test('cumulative points for 90 days (all milestones)', () => {
    let total = 0;
    for (let day = 1; day <= 90; day++) {
      total += getDailyReward(day) + getMilestoneBonus(day);
    }
    // 90 days = 12 full cycles (84) + 6 extra days
    // 12 * 875 = 10500, + days 85-90 = 50+75+100+125+150+175 = 675 → 11175
    // Milestones: 500+750+1500+3000+5000 = 10750
    // Total: 21925
    expect(total).toBe(21925);
  });
});

// ─── Streak State Transitions ────────────────────────────────────────────────

describe('Daily Login - Invariants', () => {
  test('daily rewards are always positive', () => {
    for (let day = 1; day <= 1000; day++) {
      expect(getDailyReward(day)).toBeGreaterThan(0);
    }
  });

  test('milestone bonuses are never negative', () => {
    for (let day = 0; day <= 1000; day++) {
      expect(getMilestoneBonus(day)).toBeGreaterThanOrEqual(0);
    }
  });

  test('getNextMilestone returns valid values', () => {
    for (let streak = 0; streak <= 100; streak++) {
      const { nextMilestone, daysUntilMilestone } = getNextMilestone(streak);
      expect(nextMilestone).toBeGreaterThanOrEqual(0);
      expect(daysUntilMilestone).toBeGreaterThanOrEqual(0);
      if (nextMilestone > 0) {
        expect(nextMilestone).toBeGreaterThan(streak);
        expect(daysUntilMilestone).toBe(nextMilestone - streak);
      }
    }
  });

  test('claim status time values are non-negative', () => {
    const NOW = 1700000000000;
    const testTimes = [null, NOW, NOW - HOUR, NOW - 25 * HOUR, NOW - 48 * HOUR];
    for (const time of testTimes) {
      const status = getClaimStatus(time, NOW);
      expect(status.timeUntilClaim).toBeGreaterThanOrEqual(0);
      expect(status.timeUntilReset).toBeGreaterThanOrEqual(0);
    }
  });
});
