import type { Memory } from '@elizaos/core';
import { z } from 'zod';

const finite = z.number().finite();
const id = z.string().min(1);

export const balanceContextSchema = z.object({
  balance: finite.nonnegative(),
  reputationPoints: finite,
  lifetimePnL: finite,
});

export const positionsContextSchema = z.object({
  marketPositions: z.array(
    z.object({
      id,
      marketId: id,
      question: id,
      side: z.enum(['YES', 'NO']),
      shares: finite.positive(),
      avgPrice: finite.nonnegative(),
      currentPrice: finite.min(0).max(1),
      unrealizedPnL: finite,
    })
  ),
  perpPositions: z.array(
    z.object({
      id,
      ticker: id,
      side: z.enum(['long', 'short']),
      size: finite.positive(),
      amount: finite.positive().optional(),
      entryPrice: finite.positive(),
      currentPrice: finite.positive(),
      leverage: finite.positive(),
      unrealizedPnL: finite,
    })
  ),
});

/** Missing collections are failed retrievals, not successful empty results. */
export function requireContextArray<T>(
  value: T[] | undefined | null,
  label: string
): T[] {
  if (!Array.isArray(value))
    throw new Error(`${label} must be an explicit array`);
  return value;
}

export function requireContextNumber(
  value: number | undefined | null,
  label: string
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

export const userWalletContextSchema = z.object({
  balance: balanceContextSchema.extend({
    totalDeposited: finite.nonnegative(),
    totalWithdrawn: finite.nonnegative(),
  }),
  positions: positionsContextSchema,
});

export function explicitContextUserId(message: Memory): string | undefined {
  const explicitId = message.content?.userId;
  return typeof explicitId === 'string' && explicitId.trim()
    ? explicitId.trim()
    : message.content?.text?.match(/\buserId\s*[:=]\s*([A-Za-z0-9_-]+)/i)?.[1];
}

export const userProfileContextSchema = z.object({
  id,
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  reputationPoints: finite,
  virtualBalance: finite.nonnegative(),
});

export const predictionMarketsContextSchema = z.object({
  predictions: z.array(
    z.object({
      id,
      question: id,
      yesShares: finite.nonnegative(),
      noShares: finite.nonnegative(),
      liquidity: finite.nonnegative(),
      resolved: z.boolean(),
      endDate: z.string().datetime(),
    })
  ),
});

export const perpetualMarketsContextSchema = z.object({
  perpetuals: z.array(
    z.object({
      ticker: id,
      name: id,
      currentPrice: finite.positive(),
      priceChange24h: finite,
      volume24h: finite.nonnegative(),
      openInterest: finite.nonnegative(),
      fundingRate: finite,
    })
  ),
});

export const organizationMentionsContextSchema = z.object({
  organizations: z.array(
    z.object({
      id,
      name: id,
      ticker: id.nullable(),
      description: z.string(),
      imageUrl: z.string().nullable(),
      currentPrice: finite.positive().nullable(),
      initialPrice: finite.positive().nullable(),
      priceChangePercentage: finite.nullable(),
    })
  ),
});

export const userMentionsContextSchema = z.object({
  users: z.array(
    z.object({
      id,
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      bio: z.string().nullable(),
      isAgent: z.boolean(),
      reputationPoints: finite,
    })
  ),
});

export const trendingContextSchema = z.object({
  tags: z.array(
    z.object({
      id,
      name: id,
      displayName: id,
      category: z.string().nullable(),
      postCount: finite.int().nonnegative(),
      score: finite,
    })
  ),
});

export const chatsContextSchema = z.object({
  chats: z.array(
    z.object({
      id,
      name: z.string().nullable(),
      isGroup: z.boolean(),
      participants: z.array(z.object({ id })).min(1),
    })
  ),
});
