/**
 * Random Context Provider
 *
 * Fetches random contextual data to inject into prompts for entropy:
 * - Active questions/predictions
 * - Market gainers/losers
 * - Recent posts
 * - Recent public news/events
 *
 * This adds variety and prevents AI from falling into repetitive patterns.
 */

import { PredictionPricing } from '@feed/core/markets/prediction';
import {
  and,
  db,
  desc,
  eq,
  getDbInstance,
  gte,
  isNull,
  lte,
  markets,
  posts,
  sql,
  users,
  worldEvents,
} from '@feed/db';
import { logger } from '@feed/shared';
import { StaticDataRegistry } from '../services/static-data-registry';
import { sampleRandom, shuffleArray } from '../utils/randomization';

export interface RandomMarketContext {
  gainers?: Array<{ name: string; price: number; change: number }>;
  losers?: Array<{ name: string; price: number; change: number }>;
  activeQuestions?: Array<{ question: string; yesPrice: number }>;
  recentPosts?: Array<{ author: string | null; content: string }>;
  recentEvents?: Array<{ title: string; description: string }>;
}

type CompanyMove = { name: string; price: number; change: number };

/**
 * Lifetime price change (current vs initial price) for every listed company,
 * from one organization-state snapshot shared by gainers and losers.
 */
async function getCompanyMoves(): Promise<CompanyMove[]> {
  const staticOrgs = StaticDataRegistry.getAllOrganizations().filter(
    (o) => o.type === 'company'
  );
  const orgStates = await getDbInstance().getAllOrganizationStates();
  const priceMap = new Map(
    orgStates.map((s): [string, number | null] => [s.id, s.currentPrice])
  );

  const moves: CompanyMove[] = [];
  for (const org of staticOrgs) {
    const initial = org.initialPrice;
    const current = priceMap.get(org.id) ?? initial;
    if (initial === null || current === null || initial <= 0) continue;
    moves.push({
      name: org.name,
      price: current,
      change: ((current - initial) / initial) * 100,
    });
  }
  return moves;
}

/**
 * Get random active prediction questions
 */
async function getActiveQuestions(
  limit = 3
): Promise<Array<{ question: string; yesPrice: number }>> {
  try {
    const now = new Date();
    const marketsResult = await db
      .select()
      .from(markets)
      .where(and(eq(markets.resolved, false), gte(markets.endDate, now)))
      // Random order in SQL so markets beyond the sample window are not starved
      .orderBy(sql`random()`)
      .limit(20);

    const formatted = marketsResult.flatMap((m) => {
      const yesShares = Number(m.yesShares);
      const noShares = Number(m.noShares);
      if (
        !Number.isFinite(yesShares) ||
        !Number.isFinite(noShares) ||
        yesShares <= 0 ||
        noShares <= 0
      ) {
        return [];
      }
      // Canonical CPMM spot price (YES price = noShares / total)
      const yesPrice = Math.round(
        PredictionPricing.getCurrentPrice(yesShares, noShares, 'yes') * 100
      );
      return [{ question: m.question, yesPrice }];
    });

    // Randomly sample
    return sampleRandom(formatted, limit);
  } catch (error) {
    logger.error(
      'Error fetching active questions',
      { error },
      'random-context'
    );
    return [];
  }
}

/**
 * Get a sample of recent, non-deleted posts with their real author names.
 */
async function getRecentPosts(
  limit = 3
): Promise<Array<{ author: string | null; content: string }>> {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const postsResult = await db
      .select({
        authorId: posts.authorId,
        content: posts.content,
        displayName: users.displayName,
        username: users.username,
      })
      .from(posts)
      .leftJoin(users, eq(users.id, posts.authorId))
      .where(
        and(
          gte(posts.timestamp, oneDayAgo),
          lte(posts.timestamp, now),
          isNull(posts.deletedAt)
        )
      )
      .orderBy(desc(posts.timestamp))
      .limit(20); // Get more, then sample

    const formatted = postsResult.map((p) => ({
      author:
        StaticDataRegistry.getActor(p.authorId)?.name ??
        p.displayName ??
        p.username ??
        null,
      content:
        p.content.length > 150 ? p.content.slice(0, 150) + '...' : p.content,
    }));

    return sampleRandom(formatted, limit);
  } catch (error) {
    logger.error('Error fetching recent posts', { error }, 'random-context');
    return [];
  }
}

/**
 * Get recent world events
 */
async function getRecentEvents(
  limit = 2
): Promise<Array<{ title: string; description: string }>> {
  try {
    const now = new Date();
    const eventsResult = await db
      .select()
      .from(worldEvents)
      .where(
        and(
          lte(worldEvents.timestamp, now),
          eq(worldEvents.visibility, 'public')
        )
      )
      .orderBy(desc(worldEvents.timestamp))
      .limit(10); // Get more, then sample

    const formatted = eventsResult.map((e) => ({
      title: e.eventType, // Use eventType as title since there's no title field
      description:
        e.description.length > 100
          ? e.description.slice(0, 100) + '...'
          : e.description,
    }));

    return sampleRandom(formatted, limit);
  } catch (error) {
    logger.error('Error fetching recent events', { error }, 'random-context');
    return [];
  }
}

/**
 * Generate a random market context bundle
 * Each call returns different random samples for variety
 */
export async function generateRandomMarketContext(options?: {
  includeGainers?: boolean;
  includeLosers?: boolean;
  includeQuestions?: boolean;
  includePosts?: boolean;
  includeEvents?: boolean;
}): Promise<RandomMarketContext> {
  const {
    includeGainers = true,
    includeLosers = true,
    includeQuestions = true,
    includePosts = true,
    includeEvents = true,
  } = options || {};

  const [moves, activeQuestions, recentPosts, recentEvents] = await Promise.all(
    [
      includeGainers || includeLosers
        ? getCompanyMoves().catch((error: unknown) => {
            logger.error(
              'Error fetching company price moves',
              { error },
              'random-context'
            );
            return [] as CompanyMove[];
          })
        : Promise.resolve([] as CompanyMove[]),
      includeQuestions ? getActiveQuestions(3) : Promise.resolve(undefined),
      includePosts ? getRecentPosts(3) : Promise.resolve(undefined),
      includeEvents ? getRecentEvents(2) : Promise.resolve(undefined),
    ]
  );

  const gainers = includeGainers
    ? moves
        .filter((m) => m.change > 0)
        .sort((a, b) => b.change - a.change)
        .slice(0, 3)
    : undefined;
  const losers = includeLosers
    ? moves
        .filter((m) => m.change < 0)
        .sort((a, b) => a.change - b.change)
        .slice(0, 3)
    : undefined;

  return {
    gainers,
    losers,
    activeQuestions,
    recentPosts,
    recentEvents,
  };
}

/**
 * Format random context as a string for injection into prompts
 */
export function formatRandomContext(context: RandomMarketContext): string {
  const parts: string[] = [];

  if (context.gainers && context.gainers.length > 0) {
    parts.push(
      `Top Gainers (since listing): ${context.gainers.map((g) => `${g.name} (+${g.change.toFixed(1)}%)`).join(', ')}`
    );
  }

  if (context.losers && context.losers.length > 0) {
    parts.push(
      `Top Losers (since listing): ${context.losers.map((l) => `${l.name} (${l.change.toFixed(1)}%)`).join(', ')}`
    );
  }

  if (context.activeQuestions && context.activeQuestions.length > 0) {
    parts.push(
      `Active Questions:\n${context.activeQuestions.map((q) => `- ${q.question} (${q.yesPrice}% Yes)`).join('\n')}`
    );
  }

  if (context.recentPosts && context.recentPosts.length > 0) {
    parts.push(
      `Recent Posts:\n${context.recentPosts.map((p) => `- ${p.author ? `@${p.author}: ` : ''}"${p.content}"`).join('\n')}`
    );
  }

  if (context.recentEvents && context.recentEvents.length > 0) {
    parts.push(
      `Recent Events:\n${context.recentEvents.map((e) => `- ${e.title}: ${e.description}`).join('\n')}`
    );
  }

  return parts.length > 0
    ? `\n\nCurrent Context (for awareness, you don't need to respond to this):\n${parts.join('\n\n')}`
    : '';
}

/**
 * Shuffle actors array for use in prompts
 */
export function shuffleActors<T>(actors: T[]): T[] {
  return shuffleArray(actors);
}
