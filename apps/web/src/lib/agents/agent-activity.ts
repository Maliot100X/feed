/**
 * Shared agent activity query used by `/api/agents/activity` (all owned
 * agents) and `/api/agents/[agentId]/activity` (one owned agent).
 *
 * Callers are responsible for authorization: pass only agent ids the caller
 * owns.
 */

import {
  agentTrades,
  and,
  comments,
  db,
  desc,
  inArray,
  isNull,
  markets,
  posts,
} from '@feed/db';
import { toISO } from '@feed/shared';
import { z } from 'zod';

export const AgentActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  type: z.enum(['all', 'trade', 'post', 'comment']).default('all'),
});

export type AgentActivityQuery = z.infer<typeof AgentActivityQuerySchema>;
export type AgentActivityType = AgentActivityQuery['type'];

/**
 * Parse activity query params. `URLSearchParams.get` returns `null` for absent
 * params, and Zod defaults only apply to `undefined`, so normalize first.
 */
export function parseAgentActivityQuery(
  searchParams: URLSearchParams
): AgentActivityQuery {
  return AgentActivityQuerySchema.parse({
    limit: searchParams.get('limit') ?? undefined,
    type: searchParams.get('type') ?? undefined,
  });
}

interface ActivityBase {
  id: string;
  timestamp: string;
  agentId: string;
}

export interface TradeActivity extends ActivityBase {
  type: 'trade';
  data: {
    tradeId: string;
    marketType: 'prediction' | 'perp';
    marketId: string | null;
    ticker: string | null;
    marketQuestion: string | null;
    action: string;
    side: string | null;
    amount: number;
    price: number;
    pnl: number | null;
    reasoning: string | null;
  };
}

export interface PostActivity extends ActivityBase {
  type: 'post';
  data: {
    postId: string;
    contentPreview: string;
  };
}

export interface CommentActivity extends ActivityBase {
  type: 'comment';
  data: {
    commentId: string;
    postId: string;
    contentPreview: string;
    parentCommentId: string | null;
  };
}

export type AgentActivity = TradeActivity | PostActivity | CommentActivity;

const CONTENT_PREVIEW_LENGTH = 200;

/**
 * Merge per-source activity lists (each fetched with `limit + 1` rows) into
 * one page. Ordering is newest first with a stable type/id tie-break, and
 * `hasMore` is exact: if any source had more than `limit` rows, or the merged
 * set exceeds `limit`, there is at least one more activity.
 */
export function mergeAgentActivities(
  sources: AgentActivity[][],
  limit: number
): { activities: AgentActivity[]; hasMore: boolean } {
  const merged = sources.flat();
  merged.sort((a, b) => {
    const byTime = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    if (byTime !== 0) return byTime;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return {
    activities: merged.slice(0, limit),
    hasMore: merged.length > limit,
  };
}

function isMarketType(value: string): value is 'prediction' | 'perp' {
  return value === 'prediction' || value === 'perp';
}

async function fetchTrades(
  agentIds: string[],
  rows: number
): Promise<TradeActivity[]> {
  const trades = await db
    .select({
      id: agentTrades.id,
      agentUserId: agentTrades.agentUserId,
      marketType: agentTrades.marketType,
      marketId: agentTrades.marketId,
      ticker: agentTrades.ticker,
      action: agentTrades.action,
      side: agentTrades.side,
      amount: agentTrades.amount,
      price: agentTrades.price,
      pnl: agentTrades.pnl,
      reasoning: agentTrades.reasoning,
      executedAt: agentTrades.executedAt,
    })
    .from(agentTrades)
    .where(inArray(agentTrades.agentUserId, agentIds))
    .orderBy(desc(agentTrades.executedAt), desc(agentTrades.id))
    .limit(rows);

  const marketIds = [
    ...new Set(
      trades.flatMap((t) =>
        t.marketType === 'prediction' && t.marketId ? [t.marketId] : []
      )
    ),
  ];

  const marketQuestions = new Map<string, string>();
  if (marketIds.length > 0) {
    const marketsData = await db
      .select({ id: markets.id, question: markets.question })
      .from(markets)
      .where(inArray(markets.id, marketIds));
    for (const m of marketsData) {
      marketQuestions.set(m.id, m.question);
    }
  }

  return trades.flatMap((trade): TradeActivity[] => {
    if (!isMarketType(trade.marketType)) return [];
    return [
      {
        type: 'trade',
        id: trade.id,
        agentId: trade.agentUserId,
        timestamp: toISO(trade.executedAt),
        data: {
          tradeId: trade.id,
          marketType: trade.marketType,
          marketId: trade.marketId,
          ticker: trade.ticker,
          marketQuestion: trade.marketId
            ? (marketQuestions.get(trade.marketId) ?? null)
            : null,
          action: trade.action,
          side: trade.side,
          amount: trade.amount,
          price: trade.price,
          pnl: trade.pnl,
          reasoning: trade.reasoning,
        },
      },
    ];
  });
}

async function fetchPosts(
  agentIds: string[],
  rows: number
): Promise<PostActivity[]> {
  const agentPosts = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      content: posts.content,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(inArray(posts.authorId, agentIds), isNull(posts.deletedAt)))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(rows);

  return agentPosts.map((post) => ({
    type: 'post',
    id: post.id,
    agentId: post.authorId,
    timestamp: toISO(post.createdAt),
    data: {
      postId: post.id,
      contentPreview: post.content.substring(0, CONTENT_PREVIEW_LENGTH),
    },
  }));
}

async function fetchComments(
  agentIds: string[],
  rows: number
): Promise<CommentActivity[]> {
  const agentComments = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      postId: comments.postId,
      content: comments.content,
      parentCommentId: comments.parentCommentId,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(
      and(inArray(comments.authorId, agentIds), isNull(comments.deletedAt))
    )
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(rows);

  return agentComments.map((comment) => ({
    type: 'comment',
    id: comment.id,
    agentId: comment.authorId,
    timestamp: toISO(comment.createdAt),
    data: {
      commentId: comment.id,
      postId: comment.postId,
      contentPreview: comment.content.substring(0, CONTENT_PREVIEW_LENGTH),
      parentCommentId: comment.parentCommentId,
    },
  }));
}

/**
 * Most recent non-deleted activity (trades, posts, comments) for the given
 * owned agents.
 */
export async function getAgentActivity(params: {
  agentIds: string[];
  limit: number;
  type: AgentActivityType;
}): Promise<{ activities: AgentActivity[]; hasMore: boolean }> {
  const { agentIds, limit, type } = params;
  if (agentIds.length === 0) return { activities: [], hasMore: false };

  // limit + 1 per source so hasMore is exact.
  const rows = limit + 1;
  const sources = await Promise.all([
    type === 'all' || type === 'trade' ? fetchTrades(agentIds, rows) : [],
    type === 'all' || type === 'post' ? fetchPosts(agentIds, rows) : [],
    type === 'all' || type === 'comment' ? fetchComments(agentIds, rows) : [],
  ]);

  return mergeAgentActivities(sources, limit);
}
