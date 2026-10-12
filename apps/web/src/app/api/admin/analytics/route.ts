/**
 * Admin Analytics API
 *
 * @route GET /api/admin/analytics - Get analytics time series data
 * @access Admin
 *
 * @description
 * Returns time-series analytics data for the admin dashboard charts.
 * Supports various periods (day, week, month) and metrics.
 *
 * @openapi
 * /api/admin/analytics:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get analytics data
 *     description: Returns time-series analytics data for charts (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: period
 *         in: query
 *         description: Time period granularity for analytics data
 *         schema:
 *           type: string
 *           enum: [day, week, month]
 *           default: week
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */

import { requireAdmin, successResponse, withErrorHandling } from '@feed/api';
import {
  and,
  comments,
  count,
  db,
  follows,
  gte,
  lt,
  posts,
  reactions,
  sql,
  users,
} from '@feed/db';
import { logger, toISO } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { getAnalyticsBuckets, type PeriodType } from './_buckets';

const VALID_PERIODS: PeriodType[] = ['day', 'week', 'month'];

export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const { searchParams } = new URL(request.url);
  const periodParam = searchParams.get('period') || 'week';
  const period: PeriodType = VALID_PERIODS.includes(periodParam as PeriodType)
    ? (periodParam as PeriodType)
    : 'week';

  logger.info(
    'Admin analytics requested',
    { period },
    'GET /api/admin/analytics'
  );

  // Fixed, bounded UTC buckets over a half-open [start, end) window.
  const { start, end, keys } = getAnalyticsBuckets(period);

  // Execute all queries in parallel for better performance
  const [
    userSignups,
    postsCreated,
    commentsCreated,
    reactionsCreated,
    followsCreated,
  ] = await Promise.all([
    // User signups
    db
      .select({
        date: (period === 'month'
          ? sql<string>`TO_CHAR(DATE_TRUNC('month', ${users.createdAt}), 'YYYY-MM')`
          : sql<string>`TO_CHAR(DATE(${users.createdAt}), 'YYYY-MM-DD')`
        ).as('date'),
        count: count(),
      })
      .from(users)
      .where(and(gte(users.createdAt, start), lt(users.createdAt, end)))
      .groupBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${users.createdAt})`
          : sql`DATE(${users.createdAt})`
      )
      .orderBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${users.createdAt})`
          : sql`DATE(${users.createdAt})`
      ),

    // Posts
    db
      .select({
        date: (period === 'month'
          ? sql<string>`TO_CHAR(DATE_TRUNC('month', ${posts.createdAt}), 'YYYY-MM')`
          : sql<string>`TO_CHAR(DATE(${posts.createdAt}), 'YYYY-MM-DD')`
        ).as('date'),
        count: count(),
      })
      .from(posts)
      .where(and(gte(posts.createdAt, start), lt(posts.createdAt, end)))
      .groupBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${posts.createdAt})`
          : sql`DATE(${posts.createdAt})`
      )
      .orderBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${posts.createdAt})`
          : sql`DATE(${posts.createdAt})`
      ),

    // Comments
    db
      .select({
        date: (period === 'month'
          ? sql<string>`TO_CHAR(DATE_TRUNC('month', ${comments.createdAt}), 'YYYY-MM')`
          : sql<string>`TO_CHAR(DATE(${comments.createdAt}), 'YYYY-MM-DD')`
        ).as('date'),
        count: count(),
      })
      .from(comments)
      .where(and(gte(comments.createdAt, start), lt(comments.createdAt, end)))
      .groupBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${comments.createdAt})`
          : sql`DATE(${comments.createdAt})`
      )
      .orderBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${comments.createdAt})`
          : sql`DATE(${comments.createdAt})`
      ),

    // Reactions
    db
      .select({
        date: (period === 'month'
          ? sql<string>`TO_CHAR(DATE_TRUNC('month', ${reactions.createdAt}), 'YYYY-MM')`
          : sql<string>`TO_CHAR(DATE(${reactions.createdAt}), 'YYYY-MM-DD')`
        ).as('date'),
        count: count(),
      })
      .from(reactions)
      .where(and(gte(reactions.createdAt, start), lt(reactions.createdAt, end)))
      .groupBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${reactions.createdAt})`
          : sql`DATE(${reactions.createdAt})`
      )
      .orderBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${reactions.createdAt})`
          : sql`DATE(${reactions.createdAt})`
      ),

    // Follows
    db
      .select({
        date: (period === 'month'
          ? sql<string>`TO_CHAR(DATE_TRUNC('month', ${follows.createdAt}), 'YYYY-MM')`
          : sql<string>`TO_CHAR(DATE(${follows.createdAt}), 'YYYY-MM-DD')`
        ).as('date'),
        count: count(),
      })
      .from(follows)
      .where(and(gte(follows.createdAt, start), lt(follows.createdAt, end)))
      .groupBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${follows.createdAt})`
          : sql`DATE(${follows.createdAt})`
      )
      .orderBy(
        period === 'month'
          ? sql`DATE_TRUNC('month', ${follows.createdAt})`
          : sql`DATE(${follows.createdAt})`
      ),
  ]);

  // Build unified time-series data
  const dateMap = new Map<
    string,
    {
      date: string;
      users: number;
      posts: number;
      comments: number;
      reactions: number;
      follows: number;
    }
  >();

  // Initialize every bucket in range
  for (const key of keys) {
    dateMap.set(key, {
      date: key,
      users: 0,
      posts: 0,
      comments: 0,
      reactions: 0,
      follows: 0,
    });
  }

  // Fill in data from queries
  for (const row of userSignups) {
    const key = row.date;
    const entry = dateMap.get(key);
    if (entry) entry.users = row.count;
  }

  for (const row of postsCreated) {
    const key = row.date;
    const entry = dateMap.get(key);
    if (entry) entry.posts = row.count;
  }

  for (const row of commentsCreated) {
    const key = row.date;
    const entry = dateMap.get(key);
    if (entry) entry.comments = row.count;
  }

  for (const row of reactionsCreated) {
    const key = row.date;
    const entry = dateMap.get(key);
    if (entry) entry.reactions = row.count;
  }

  for (const row of followsCreated) {
    const key = row.date;
    const entry = dateMap.get(key);
    if (entry) entry.follows = row.count;
  }

  // Buckets were inserted in chronological order
  const timeSeries = Array.from(dateMap.values());

  // Calculate totals in single pass (more efficient than multiple reduce calls)
  const totals = { users: 0, posts: 0, comments: 0, reactions: 0, follows: 0 };
  for (const d of timeSeries) {
    totals.users += d.users;
    totals.posts += d.posts;
    totals.comments += d.comments;
    totals.reactions += d.reactions;
    totals.follows += d.follows;
  }

  return successResponse({
    period,
    startDate: toISO(start),
    endDate: toISO(end),
    timeSeries,
    totals,
  });
});
