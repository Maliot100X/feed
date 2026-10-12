/**
 * Admin Trading Feed API
 *
 * @route GET /api/admin/trades - Get trading feed
 * @access Admin
 *
 * @description
 * Read-only feed of recent ledger activity: balance transactions, NPC trades
 * and position snapshots (positions are current state, ordered by last
 * update, not historical fills). Requires admin authentication.
 *
 * @openapi
 * /api/admin/trades:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get trading feed
 *     description: Returns recent trades across all markets (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Results per page
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 1000
 *           default: 0
 *         description: Pagination offset
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, balance, npc, position]
 *           default: all
 *         description: Filter by trade type
 *     responses:
 *       200:
 *         description: Trading feed retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 trades:
 *                   type: array
 *                 pagination:
 *                   type: object
 *                 counts:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * const feed = await fetch('/api/admin/trades?type=balance&limit=20', {
 *   headers: { 'Authorization': `Bearer ${adminToken}` }
 * }).then(r => r.json());
 * ```
 *
 * @see {@link /lib/api/admin-middleware} Admin middleware
 */

import { requireAdmin, successResponse, withErrorHandling } from '@feed/api';
import { db } from '@feed/db';
import { StaticDataRegistry } from '@feed/engine';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

/**
 * Merged pagination fetches `offset + limit` rows from each source, so the
 * offset is bounded to keep the per-request scan finite.
 */
const MAX_OFFSET = 1000;

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  type: z.enum(['all', 'balance', 'npc', 'position']).default('all'),
});

const userSelect = {
  id: true,
  username: true,
  displayName: true,
  profileImageUrl: true,
  isActor: true,
} as const;

export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const { searchParams } = new URL(request.url);
  const params = QuerySchema.parse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
    type: searchParams.get('type') ?? undefined,
  });

  logger.info(
    'Admin trading feed requested',
    { params },
    'GET /api/admin/trades'
  );

  const includeBalance = params.type === 'all' || params.type === 'balance';
  const includeNpc = params.type === 'all' || params.type === 'npc';
  const includePosition = params.type === 'all' || params.type === 'position';

  // Each source is read from the top so that the merged, timestamp-sorted
  // window [offset, offset + limit) is exact across sources. Offsetting each
  // source independently would skip rows that belong on the requested page.
  const window = params.offset + params.limit;

  const [balanceTransactions, npcTrades, positions] = await Promise.all([
    includeBalance
      ? db.balanceTransaction.findMany({
          take: window,
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    includeNpc
      ? db.npcTrade.findMany({
          take: window,
          orderBy: { executedAt: 'desc' },
        })
      : Promise.resolve([]),
    includePosition
      ? db.position.findMany({
          take: window,
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),
  ]);

  const userIds = [
    ...new Set([
      ...balanceTransactions.map((tx) => tx.userId),
      ...positions.map((pos) => pos.userId),
    ]),
  ];
  const marketIds = [...new Set(positions.map((pos) => pos.marketId))];

  const [users, markets] = await Promise.all([
    userIds.length > 0
      ? db.user.findMany({
          where: { id: { in: userIds } },
          select: userSelect,
        })
      : Promise.resolve([]),
    marketIds.length > 0
      ? db.market.findMany({
          where: { id: { in: marketIds } },
          select: {
            id: true,
            question: true,
            resolved: true,
            resolution: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const usersMap = new Map(users.map((u) => [u.id, u]));
  const marketsMap = new Map(markets.map((m) => [m.id, m]));

  // Rows whose user/actor/market can no longer be resolved are kept with a
  // null reference so ledger evidence is never silently hidden.
  const allTrades = [
    ...balanceTransactions.map((tx) => ({
      type: 'balance' as const,
      id: tx.id,
      timestamp: tx.createdAt,
      user: usersMap.get(tx.userId) ?? null,
      amount: tx.amount.toString(),
      balanceBefore: tx.balanceBefore.toString(),
      balanceAfter: tx.balanceAfter.toString(),
      transactionType: tx.type,
      description: tx.description,
      relatedId: tx.relatedId,
    })),
    ...npcTrades.map((trade) => {
      const actor = StaticDataRegistry.getActor(trade.npcActorId);
      return {
        type: 'npc' as const,
        id: trade.id,
        timestamp: trade.executedAt,
        user: actor
          ? {
              id: actor.id,
              username: actor.name,
              displayName: actor.name,
              profileImageUrl: actor.profileImageUrl ?? null,
              isActor: true,
            }
          : null,
        marketType: trade.marketType,
        ticker: trade.ticker,
        marketId: trade.marketId,
        action: trade.action,
        side: trade.side,
        amount: trade.amount,
        price: trade.price,
        sentiment: trade.sentiment,
        reason: trade.reason,
      };
    }),
    ...positions.map((pos) => ({
      type: 'position' as const,
      id: pos.id,
      timestamp: pos.updatedAt,
      user: usersMap.get(pos.userId) ?? null,
      market: marketsMap.get(pos.marketId) ?? null,
      side: pos.side ? 'YES' : 'NO',
      shares: pos.shares.toString(),
      avgPrice: pos.avgPrice.toString(),
      createdAt: pos.createdAt,
    })),
  ];

  allTrades.sort((a, b) => {
    const byTime = b.timestamp.getTime() - a.timestamp.getTime();
    if (byTime !== 0) return byTime;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const pageTrades = allTrades.slice(params.offset, window);

  const [balanceCount, npcCount, positionCount] = await Promise.all([
    includeBalance ? db.balanceTransaction.count() : Promise.resolve(0),
    includeNpc ? db.npcTrade.count() : Promise.resolve(0),
    includePosition ? db.position.count() : Promise.resolve(0),
  ]);
  const total = balanceCount + npcCount + positionCount;

  return successResponse({
    trades: pageTrades,
    pagination: {
      limit: params.limit,
      offset: params.offset,
      total,
      hasMore: params.offset + pageTrades.length < total,
    },
    counts: {
      balance: balanceCount,
      npc: npcCount,
      position: positionCount,
    },
  });
});
