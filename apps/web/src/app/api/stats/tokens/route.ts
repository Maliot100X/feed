/**
 * Token Statistics API
 *
 * @route GET /api/stats/tokens - Get LLM token usage statistics
 * @access Public (rate-limited, cached)
 *
 * @description
 * Returns LLM token usage statistics for the game engine. Includes
 * aggregated totals, breakdowns by prompt type and model, and estimated costs.
 *
 * This endpoint is public but rate-limited (shared public read limiter).
 * Results are cached for 5 minutes to reduce database load. Totals aggregate
 * the most recent `limit` persisted ticks within the period (a sample, not
 * the entire period).
 *
 * @openapi
 * /api/stats/tokens:
 *   get:
 *     tags:
 *       - Statistics
 *     summary: Get LLM token usage statistics
 *     description: Returns aggregated LLM token usage statistics with breakdowns by prompt type and model
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 100
 *         description: Number of recent ticks to include in summary (default 10, max 100)
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [hour, day, week]
 *           default: day
 *         description: Time period for statistics (hour, day, or week)
 *     responses:
 *       200:
 *         description: Token statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 summary:
 *                   type: object
 *                   properties:
 *                     periodStart:
 *                       type: string
 *                       format: date-time
 *                     periodEnd:
 *                       type: string
 *                       format: date-time
 *                     tickCount:
 *                       type: integer
 *                     totalCalls:
 *                       type: integer
 *                     totalInputTokens:
 *                       type: integer
 *                     totalOutputTokens:
 *                       type: integer
 *                     totalTokens:
 *                       type: integer
 *                     avgCallsPerTick:
 *                       type: integer
 *                     estimatedTotalCostUSD:
 *                       type: number
 *                 byPromptType:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       promptType:
 *                         type: string
 *                       callCount:
 *                         type: integer
 *                       totalTokens:
 *                         type: integer
 *                 byModel:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       model:
 *                         type: string
 *                       callCount:
 *                         type: integer
 *                       totalTokens:
 *                         type: integer
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Internal server error
 *
 * @example
 * ```typescript
 * // Basic usage
 * const response = await fetch('/api/stats/tokens');
 * const { summary, byPromptType, byModel } = await response.json();
 * console.log(`Total tokens used: ${summary.totalTokens}`);
 * console.log(`Estimated cost: $${summary.estimatedTotalCostUSD.toFixed(4)}`);
 *
 * // With parameters
 * const response = await fetch('/api/stats/tokens?limit=50&period=week');
 * ```
 */

import {
  addPublicReadHeaders,
  CACHE_KEYS,
  DEFAULT_TTLS,
  getCacheOrFetch,
  publicRateLimit,
  withErrorHandling,
} from '@feed/api';
import { db, desc, gte, tickTokenStats } from '@feed/db';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Disable static generation for this route
export const dynamic = 'force-dynamic';

const PERIOD_MS = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
} as const;

const TokenStatsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  period: z.enum(['hour', 'day', 'week']).default('day'),
});

const UsageCountsSchema = z.object({
  callCount: z.number().finite(),
  totalInputTokens: z.number().finite(),
  totalOutputTokens: z.number().finite(),
  totalTokens: z.number().finite(),
});

const ByPromptTypeSchema = z.array(
  UsageCountsSchema.extend({ promptType: z.string() })
);

const ByModelSchema = z.array(
  UsageCountsSchema.extend({ provider: z.string(), model: z.string() })
);

type UsageCounts = z.infer<typeof UsageCountsSchema>;

function emptyCounts(): UsageCounts {
  return {
    callCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
  };
}

function addCounts(target: UsageCounts, source: UsageCounts): void {
  target.callCount += source.callCount;
  target.totalInputTokens += source.totalInputTokens;
  target.totalOutputTokens += source.totalOutputTokens;
  target.totalTokens += source.totalTokens;
}

function avgPerCall(data: UsageCounts): number {
  return data.callCount > 0 ? Math.round(data.totalTokens / data.callCount) : 0;
}

export const GET = withErrorHandling(async function GET(request: NextRequest) {
  const { error, rateLimitInfo } = await publicRateLimit(request);
  if (error) return error;

  const searchParams = request.nextUrl.searchParams;
  const { limit, period } = TokenStatsQuerySchema.parse({
    limit: searchParams.get('limit') ?? undefined,
    period: searchParams.get('period') ?? undefined,
  });

  const now = new Date();
  const periodStart = new Date(now.getTime() - PERIOD_MS[period]);

  // Cache key only contains validated values (bounded key space).
  const cacheKey = `token-stats:${period}:${limit}`;

  const stats = await getCacheOrFetch(
    cacheKey,
    async () => {
      // Persisted per-tick stats are the only source; worker-local in-memory
      // stats are not substituted because they ignore the requested period.
      // NOTE: this aggregates the most recent `limit` ticks within the period
      // (sample), not the entire period.
      const dbStats = await db
        .select()
        .from(tickTokenStats)
        .where(gte(tickTokenStats.tickStartedAt, periodStart))
        .orderBy(desc(tickTokenStats.tickStartedAt))
        .limit(limit);

      const totals = emptyCounts();
      const promptTypeMap = new Map<string, UsageCounts>();
      const modelMap = new Map<
        string,
        UsageCounts & { provider: string; model: string }
      >();

      for (const tick of dbStats) {
        totals.callCount += tick.totalCalls;
        totals.totalInputTokens += tick.totalInputTokens;
        totals.totalOutputTokens += tick.totalOutputTokens;

        for (const pt of ByPromptTypeSchema.parse(tick.byPromptType)) {
          const existing = promptTypeMap.get(pt.promptType) ?? emptyCounts();
          addCounts(existing, pt);
          promptTypeMap.set(pt.promptType, existing);
        }

        for (const m of ByModelSchema.parse(tick.byModel)) {
          // Structural key: model names may contain ':'
          const key = JSON.stringify([m.provider, m.model]);
          const existing = modelMap.get(key) ?? {
            provider: m.provider,
            model: m.model,
            ...emptyCounts(),
          };
          addCounts(existing, m);
          modelMap.set(key, existing);
        }
      }
      totals.totalTokens = totals.totalInputTokens + totals.totalOutputTokens;

      const tickCount = dbStats.length;
      const perTick = (value: number) =>
        tickCount > 0 ? Math.round(value / tickCount) : 0;

      // Calculate estimated cost (rough approximation)
      // Using average cost of ~$0.50 per 1M tokens for mixed usage
      const estimatedTotalCostUSD = (totals.totalTokens / 1_000_000) * 0.5;

      return {
        summary: {
          periodStart:
            dbStats[dbStats.length - 1]?.tickStartedAt ?? periodStart,
          periodEnd: dbStats[0]?.tickCompletedAt ?? now,
          tickCount,
          totalCalls: totals.callCount,
          totalInputTokens: totals.totalInputTokens,
          totalOutputTokens: totals.totalOutputTokens,
          totalTokens: totals.totalTokens,
          avgCallsPerTick: perTick(totals.callCount),
          avgInputTokensPerTick: perTick(totals.totalInputTokens),
          avgOutputTokensPerTick: perTick(totals.totalOutputTokens),
          avgTotalTokensPerTick: perTick(totals.totalTokens),
          estimatedTotalCostUSD,
        },
        byPromptType: Array.from(promptTypeMap.entries())
          .map(([promptType, data]) => ({
            promptType,
            ...data,
            avgTokensPerCall: avgPerCall(data),
          }))
          .sort((a, b) => b.totalTokens - a.totalTokens),
        byModel: Array.from(modelMap.values())
          .map((data) => ({ ...data, avgTokensPerCall: avgPerCall(data) }))
          .sort((a, b) => b.totalTokens - a.totalTokens),
        recentTicks: dbStats.slice(0, 5).map((t) => ({
          tickId: t.tickId,
          tickStartedAt: t.tickStartedAt,
          tickCompletedAt: t.tickCompletedAt,
          totalCalls: t.totalCalls,
          totalTokens: t.totalTokens,
        })),
      };
    },
    {
      namespace: CACHE_KEYS.WIDGET,
      ttl: DEFAULT_TTLS.WIDGET, // 5 minutes
    }
  );

  const response = NextResponse.json({
    success: true,
    ...stats,
  });
  if (rateLimitInfo) addPublicReadHeaders(response, rateLimitInfo);
  return response;
});
