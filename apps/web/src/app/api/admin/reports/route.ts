/**
 * Admin Reports API
 *
 * @route GET /api/admin/reports - Get reports list
 * @access Admin
 *
 * @description
 * Returns paginated list of user reports with comprehensive filtering, sorting,
 * and moderation metrics. Includes reporter and reported user information.
 * Requires admin authentication.
 *
 * @openapi
 * /api/admin/reports:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get reports list
 *     description: Returns paginated reports with filtering and sorting (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Results per page
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Pagination offset
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, reviewed, resolved, dismissed]
 *         description: Filter by status
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high, urgent]
 *         description: Filter by priority
 *       - in: query
 *         name: reportType
 *         schema:
 *           type: string
 *         description: Filter by report type
 *       - in: query
 *         name: reporterId
 *         schema:
 *           type: string
 *         description: Filter by reporter ID
 *       - in: query
 *         name: reportedUserId
 *         schema:
 *           type: string
 *         description: Filter by reported user ID
 *       - in: query
 *         name: reportedPostId
 *         schema:
 *           type: string
 *         description: Filter by reported post ID
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created, updated]
 *           default: created
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Reports retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reports:
 *                   type: array
 *                 total:
 *                   type: integer
 *                 hasMore:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/admin/reports?status=pending&priority=high', {
 *   headers: { 'Authorization': `Bearer ${adminToken}` }
 * });
 * ```
 *
 * @see {@link /lib/api/admin-middleware} Admin middleware
 */

import { requireAdmin, successResponse, withErrorHandling } from '@feed/api';
import { and, db, desc, eq, reports, sql } from '@feed/db';
import { GetReportsSchema, logger } from '@feed/shared';
import type { NextRequest } from 'next/server';

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Require admin authentication
  await requireAdmin(request);

  const { searchParams } = new URL(request.url);
  const params = GetReportsSchema.parse({
    limit: searchParams.get('limit') || '50',
    offset: searchParams.get('offset') || '0',
    status: searchParams.get('status') || undefined,
    category: searchParams.get('category') || undefined,
    priority: searchParams.get('priority') || undefined,
    reportType: searchParams.get('reportType') || undefined,
    reporterId: searchParams.get('reporterId') || undefined,
    reportedUserId: searchParams.get('reportedUserId') || undefined,
    reportedPostId: searchParams.get('reportedPostId') || undefined,
    sortBy: searchParams.get('sortBy') || 'created',
    sortOrder: searchParams.get('sortOrder') || 'desc',
  });

  logger.info(
    'Admin reports list requested',
    { params },
    'GET /api/admin/reports'
  );

  // Build where conditions for SQL query
  const whereConditions = [];
  if (params.status) whereConditions.push(eq(reports.status, params.status));
  if (params.category)
    whereConditions.push(eq(reports.category, params.category));
  if (params.priority)
    whereConditions.push(eq(reports.priority, params.priority));
  if (params.reportType)
    whereConditions.push(eq(reports.reportType, params.reportType));
  if (params.reporterId)
    whereConditions.push(eq(reports.reporterId, params.reporterId));
  if (params.reportedUserId)
    whereConditions.push(eq(reports.reportedUserId, params.reportedUserId));
  if (params.reportedPostId)
    whereConditions.push(eq(reports.reportedPostId, params.reportedPostId));
  const whereClause =
    whereConditions.length > 0 ? and(...whereConditions) : undefined;

  // Build orderBy SQL
  let orderByClause;
  if (params.sortBy === 'created') {
    orderByClause =
      params.sortOrder === 'desc' ? desc(reports.createdAt) : reports.createdAt;
  } else if (params.sortBy === 'updated') {
    orderByClause =
      params.sortOrder === 'desc' ? desc(reports.updatedAt) : reports.updatedAt;
  } else if (params.sortBy === 'priority') {
    orderByClause =
      params.sortOrder === 'desc' ? desc(reports.priority) : reports.priority;
  } else {
    orderByClause = desc(reports.createdAt);
  }

  // Use aliases for the multiple user joins
  const reporterAlias = sql`"reporter"`;
  const reportedUserAlias = sql`"reportedUser"`;
  const resolverAlias = sql`"resolver"`;

  // Query with multiple LEFT JOINs to get user data
  const reportsQuery = await db
    .select({
      id: reports.id,
      reporterId: reports.reporterId,
      reportedUserId: reports.reportedUserId,
      reportedPostId: reports.reportedPostId,
      reportedCommentId: reports.reportedCommentId,
      reportType: reports.reportType,
      category: reports.category,
      reason: reports.reason,
      evidence: reports.evidence,
      status: reports.status,
      priority: reports.priority,
      resolution: reports.resolution,
      resolvedBy: reports.resolvedBy,
      resolvedAt: reports.resolvedAt,
      createdAt: reports.createdAt,
      updatedAt: reports.updatedAt,
      // Reporter user data
      reporterUsername: sql<string | null>`${reporterAlias}."username"`,
      reporterDisplayName: sql<string | null>`${reporterAlias}."displayName"`,
      reporterProfileImageUrl: sql<
        string | null
      >`${reporterAlias}."profileImageUrl"`,
      // Reported user data
      reportedUserUsername: sql<string | null>`${reportedUserAlias}."username"`,
      reportedUserDisplayName: sql<
        string | null
      >`${reportedUserAlias}."displayName"`,
      reportedUserProfileImageUrl: sql<
        string | null
      >`${reportedUserAlias}."profileImageUrl"`,
      reportedUserIsBanned: sql<
        boolean | null
      >`${reportedUserAlias}."isBanned"`,
      // Resolver user data
      resolverUsername: sql<string | null>`${resolverAlias}."username"`,
      resolverDisplayName: sql<string | null>`${resolverAlias}."displayName"`,
    })
    .from(reports)
    .leftJoin(
      sql`"User" AS ${reporterAlias}`,
      sql`${reports.reporterId} = ${reporterAlias}."id"`
    )
    .leftJoin(
      sql`"User" AS ${reportedUserAlias}`,
      sql`${reports.reportedUserId} = ${reportedUserAlias}."id"`
    )
    .leftJoin(
      sql`"User" AS ${resolverAlias}`,
      sql`${reports.resolvedBy} = ${resolverAlias}."id"`
    )
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(params.limit)
    .offset(params.offset);

  // Get total count for pagination
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reports)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Parse evaluation from resolution field and format response
  const reportsWithEvaluation = reportsQuery.map((report) => {
    let evaluation = null;
    if (report.resolution) {
      // Check if it's valid JSON before parsing
      const trimmed = report.resolution.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const parsed = JSON.parse(report.resolution);
        // Check if it's an evaluation object (has outcome, confidence, etc.)
        if (parsed.outcome && typeof parsed.confidence === 'number') {
          evaluation = parsed;
        }
      }
    }
    return {
      id: report.id,
      reporterId: report.reporterId,
      reportedUserId: report.reportedUserId,
      reportedPostId: report.reportedPostId,
      reportedCommentId: report.reportedCommentId,
      reportType: report.reportType,
      category: report.category,
      reason: report.reason,
      evidence: report.evidence,
      status: report.status,
      priority: report.priority,
      resolution: report.resolution,
      resolvedBy: report.resolvedBy,
      resolvedAt: report.resolvedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      reporter: {
        id: report.reporterId,
        username: report.reporterUsername,
        displayName: report.reporterDisplayName,
        profileImageUrl: report.reporterProfileImageUrl,
      },
      reportedUser: report.reportedUserId
        ? {
            id: report.reportedUserId,
            username: report.reportedUserUsername,
            displayName: report.reportedUserDisplayName,
            profileImageUrl: report.reportedUserProfileImageUrl,
            isBanned: report.reportedUserIsBanned ?? false,
          }
        : null,
      resolver: report.resolvedBy
        ? {
            id: report.resolvedBy,
            username: report.resolverUsername,
            displayName: report.resolverDisplayName,
          }
        : null,
      evaluation,
    };
  });

  return successResponse({
    reports: reportsWithEvaluation,
    pagination: {
      limit: params.limit,
      offset: params.offset,
      total,
    },
  });
});
