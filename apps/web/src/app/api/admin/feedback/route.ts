/**
 * Admin Feedback API
 *
 * Provides endpoints for admins to view and manage game feedback submissions.
 */

import {
  errorResponse,
  requireAdmin,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import {
  and,
  db,
  desc,
  eq,
  feedbacks,
  gte,
  ilike,
  lte,
  sql,
  users,
} from '@feed/db';
import { FeedbackTypeSchema, toISO } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

interface FeedbackMetadata {
  feedbackType?: string;
  stepsToReproduce?: string | null;
  screenshotUrl?: string | null;
  rating?: number | null;
  linearIssueId?: string | null;
  linearIssueIdentifier?: string | null;
  linearIssueUrl?: string | null;
}

/**
 * Escape SQL ILIKE metacharacters to prevent pattern injection.
 */
function escapeIlike(str: string): string {
  return str.replace(/[%_\\]/g, (char) => `\\${char}`);
}

const IsoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
  .transform((value) => new Date(value));

const FeedbackListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    type: FeedbackTypeSchema.optional(),
    hasLinearIssue: z.enum(['true', 'false']).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    fromDate: IsoDate.optional(),
    toDate: IsoDate.optional(),
  })
  .refine(
    (q) => !q.fromDate || !q.toDate || q.fromDate <= q.toDate,
    'fromDate must be before toDate'
  );

/**
 * GET /api/admin/feedback
 *
 * Fetches game feedback submissions with optional filtering.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const { searchParams } = new URL(request.url);

  // Invalid values are rejected instead of silently dropping the filter
  // (parseInt accepted "12junk"; bad dates removed the date filter).
  const parsedQuery = FeedbackListQuerySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    hasLinearIssue: searchParams.get('hasLinearIssue') ?? undefined,
    search: searchParams.get('search') || undefined,
    fromDate: searchParams.get('fromDate') ?? undefined,
    toDate: searchParams.get('toDate') ?? undefined,
  });
  if (!parsedQuery.success) {
    return errorResponse(
      parsedQuery.error.issues[0]?.message ?? 'Invalid query parameters',
      'VALIDATION_ERROR',
      400
    );
  }
  const {
    limit,
    offset,
    type: feedbackType,
    hasLinearIssue,
    search,
    fromDate,
    toDate,
  } = parsedQuery.data;

  // Build conditions using SQL for JSON field access
  const conditions = [eq(feedbacks.interactionType, 'general_game_feedback')];

  // feedbackType is validated against FeedbackTypeSchema above
  if (feedbackType) {
    conditions.push(
      sql`${feedbacks.metadata}->>'feedbackType' = ${feedbackType}`
    );
  }

  if (hasLinearIssue === 'true') {
    conditions.push(sql`${feedbacks.metadata}->>'linearIssueId' IS NOT NULL`);
  } else if (hasLinearIssue === 'false') {
    conditions.push(sql`${feedbacks.metadata}->>'linearIssueId' IS NULL`);
  }

  if (search) {
    // Escape ILIKE metacharacters to prevent pattern injection
    conditions.push(ilike(feedbacks.comment, `%${escapeIlike(search)}%`));
  }

  if (fromDate) {
    conditions.push(gte(feedbacks.createdAt, fromDate));
  }

  if (toDate) {
    conditions.push(lte(feedbacks.createdAt, toDate));
  }

  // Combine all conditions for reuse in count query
  const whereClause = and(...conditions);

  // Fetch feedback with user info via join
  const feedbackItems = await db
    .select({
      id: feedbacks.id,
      score: feedbacks.score,
      comment: feedbacks.comment,
      metadata: feedbacks.metadata,
      createdAt: feedbacks.createdAt,
      fromUserId: feedbacks.fromUserId,
      user: {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        profileImageUrl: users.profileImageUrl,
        email: users.email,
      },
    })
    .from(feedbacks)
    .leftJoin(users, eq(feedbacks.fromUserId, users.id))
    .where(whereClause)
    .orderBy(desc(feedbacks.createdAt), desc(feedbacks.id))
    .limit(limit)
    .offset(offset);

  // Get total count for pagination - use same filters as main query
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(feedbacks)
    .where(whereClause);
  const totalCount = countResult[0]?.count ?? 0;

  // Get stats by feedback type (unfiltered to show overall distribution)
  const statsResult = await db
    .select({
      feedbackType: sql<string>`${feedbacks.metadata}->>'feedbackType'`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(feedbacks)
    .where(eq(feedbacks.interactionType, 'general_game_feedback'))
    .groupBy(sql`${feedbacks.metadata}->>'feedbackType'`);

  // Format response
  const formattedFeedback = feedbackItems.map((item) => {
    const metadata = (item.metadata ?? {}) as FeedbackMetadata;
    return {
      id: item.id,
      feedbackType: metadata.feedbackType ?? 'unknown',
      description: item.comment,
      score: item.score,
      rating: metadata.rating,
      stepsToReproduce: metadata.stepsToReproduce,
      screenshotUrl: metadata.screenshotUrl,
      linearIssue: metadata.linearIssueId
        ? {
            id: metadata.linearIssueId,
            identifier: metadata.linearIssueIdentifier,
            url: metadata.linearIssueUrl,
          }
        : null,
      createdAt: toISO(item.createdAt),
      user: item.user?.id
        ? {
            id: item.user.id,
            username: item.user.username,
            displayName: item.user.displayName,
            profileImageUrl: item.user.profileImageUrl,
            email: item.user.email,
          }
        : null,
    };
  });

  return successResponse({
    feedback: formattedFeedback,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + feedbackItems.length < totalCount,
    },
    stats: {
      total: statsResult.reduce((acc, s) => acc + s.count, 0),
      byType: Object.fromEntries(
        statsResult.map((s) => [s.feedbackType ?? 'unknown', s.count])
      ),
    },
  });
});
