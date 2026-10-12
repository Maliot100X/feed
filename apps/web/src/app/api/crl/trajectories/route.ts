/**
 * CRL Trajectory Export API
 *
 * @route GET /api/crl/trajectories - Export trajectories with pre-computed rewards
 * @access Service (CRON_SECRET bearer token)
 *
 * Polled by the Nebius CRL trainer to fetch training data.
 * Returns trajectories with full LLM call logs and deterministic reward scores.
 *
 * Query params:
 *   since  - ISO8601 timestamp, only return trajectories created after this
 *   limit  - Max trajectories to return (default 50, max 200)
 *   cursor - Pagination cursor (trajectory ID) for next page
 */

import { withCronAuth, withErrorHandling } from '@feed/api';
import {
  and,
  asc,
  db,
  eq,
  gt,
  inArray,
  rewardJudgments,
  trajectories,
} from '@feed/db';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ExportQuerySchema = z.object({
  since: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .optional(),
  limit: z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .transform(Number)
    .pipe(z.number().int().min(1).max(200))
    .default(50),
  cursor: z.string().min(1).max(256).optional(),
});

async function exportTrajectories(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const parsedQuery = ExportQuerySchema.safeParse({
    since: searchParams.get('since') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const { since, limit, cursor } = parsedQuery.data;

  // Build conditions
  const conditions = [
    eq(trajectories.isTrainingData, true),
    eq(trajectories.usedInTraining, false),
  ];

  if (since) {
    conditions.push(gt(trajectories.createdAt, since));
  }

  if (cursor) {
    conditions.push(gt(trajectories.id, cursor));
  }

  // Fetch trajectories
  const rows = await db
    .select({
      id: trajectories.id,
      trajectoryId: trajectories.trajectoryId,
      agentId: trajectories.agentId,
      archetype: trajectories.archetype,
      windowId: trajectories.windowId,
      stepsJson: trajectories.stepsJson,
      totalReward: trajectories.totalReward,
      aiJudgeReward: trajectories.aiJudgeReward,
      rewardComponentsJson: trajectories.rewardComponentsJson,
      metricsJson: trajectories.metricsJson,
      metadataJson: trajectories.metadataJson,
      finalBalance: trajectories.finalBalance,
      finalPnL: trajectories.finalPnL,
      episodeLength: trajectories.episodeLength,
      createdAt: trajectories.createdAt,
    })
    .from(trajectories)
    .where(and(...conditions))
    .orderBy(asc(trajectories.id))
    .limit(limit + 1); // +1 to check hasMore

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id : null;

  // Fetch reward judgments for these trajectories
  const trajIds = page.map((r) => r.trajectoryId);

  const judgments =
    trajIds.length > 0
      ? await db
          .select({
            trajectoryId: rewardJudgments.trajectoryId,
            overallScore: rewardJudgments.overallScore,
            normalizedScore: rewardJudgments.normalizedScore,
            componentScoresJson: rewardJudgments.componentScoresJson,
          })
          .from(rewardJudgments)
          .where(inArray(rewardJudgments.trajectoryId, trajIds))
      : [];

  const judgmentMap = new Map(judgments.map((j) => [j.trajectoryId, j]));

  // Format response
  const result = page.map((row) => {
    const judgment = judgmentMap.get(row.trajectoryId);
    let steps: unknown[] = [];
    try {
      steps = JSON.parse(row.stepsJson || '[]');
    } catch {
      /* invalid JSON */
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadataJson || '{}');
    } catch {
      /* invalid JSON */
    }

    let componentScores: Record<string, number> = {};
    try {
      componentScores = JSON.parse(
        judgment?.componentScoresJson || row.rewardComponentsJson || '{}'
      );
    } catch {
      /* invalid JSON */
    }

    return {
      id: row.id,
      trajectoryId: row.trajectoryId,
      agentId: row.agentId,
      archetype: row.archetype,
      team: (metadata as Record<string, string>).agentTeam || 'gray',
      alignment:
        (metadata as Record<string, string>).agentAlignment || 'neutral',
      windowId: row.windowId,
      totalReward: row.totalReward,
      aiJudgeReward: row.aiJudgeReward ?? row.totalReward,
      overallScore: judgment?.overallScore ?? row.totalReward,
      componentScores,
      finalBalance: row.finalBalance,
      finalPnL: row.finalPnL,
      episodeLength: row.episodeLength,
      steps,
      createdAt: row.createdAt?.toISOString(),
    };
  });

  return NextResponse.json(
    {
      trajectories: result,
      cursor: nextCursor,
      hasMore,
      count: result.length,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export const GET = withErrorHandling(
  withCronAuth('CrlTrajectoryExport', exportTrajectories)
);
