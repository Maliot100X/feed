/**
 * Admin Network Statistics API
 *
 * @route GET /api/admin/network-stats - Get network statistics
 * @access Admin
 *
 * @description
 * Returns real-time network and database statistics including query performance,
 * slow queries, connection metrics, and database health. Admin only.
 *
 * @openapi
 * /api/admin/network-stats:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get network statistics
 *     description: Returns real-time network and database statistics (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queryStats:
 *                   type: object
 *                 slowQueries:
 *                   type: array
 *                 recentQueries:
 *                   type: array
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * const stats = await fetch('/api/admin/network-stats', {
 *   headers: { 'Authorization': `Bearer ${adminToken}` }
 * }).then(r => r.json());
 * ```
 */

import { requireAdmin, successResponse, withErrorHandling } from '@feed/api';
import { queryMonitor } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';

/**
 * GET /api/admin/network-stats
 * Get comprehensive network and database statistics
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  // Get query performance stats
  const queryStats = queryMonitor.getQueryStats(60000); // Last minute
  const slowQueries = queryMonitor.getSlowQueryStats();
  const recentQueries = queryMonitor.getRecentQueries(50);

  // Calculate query metrics
  const totalQueries = queryStats.totalQueries;
  const slowQueryRate =
    totalQueries > 0 ? (queryStats.slowQueries / totalQueries) * 100 : 0;

  // Get top 10 slowest query types
  const topSlowQueries = Object.entries(slowQueries)
    .sort((a, b) => b[1].avgDuration - a[1].avgDuration)
    .slice(0, 10)
    .map(([key, stats]) => ({
      query: key,
      count: stats.count,
      avgDuration: Math.round(stats.avgDuration * 100) / 100,
      maxDuration: Math.round(stats.maxDuration * 100) / 100,
    }));

  // Workers have no per-process memory or uptime (the methods throw there).
  const hasProcessMetrics = process.env.DEPLOYMENT_PLATFORM !== 'cloudflare';
  const memUsage = hasProcessMetrics ? process.memoryUsage() : null;
  const uptime = hasProcessMetrics ? process.uptime() : null;

  logger.info(
    'Network stats requested',
    {
      totalQueries,
      slowQueryRate: `${slowQueryRate.toFixed(2)}%`,
    },
    'GET /api/admin/network-stats'
  );

  return successResponse({
    timestamp: new Date().toISOString(),

    // Database query performance
    database: {
      queries: {
        total: totalQueries,
        slow: queryStats.slowQueries,
        slowRate: Math.round(slowQueryRate * 100) / 100,
        avgDuration: Math.round(queryStats.avgDuration * 100) / 100,
        p95Duration: Math.round(queryStats.p95Duration * 100) / 100,
        p99Duration: Math.round(queryStats.p99Duration * 100) / 100,
      },
      topSlowQueries,
      recentQueries: recentQueries.map((q) => ({
        query: q.query,
        duration: Math.round(q.duration * 100) / 100,
        timestamp: q.timestamp,
        model: q.model,
        operation: q.operation,
      })),
    },

    // Server metrics
    server: {
      uptime:
        uptime === null
          ? null
          : { seconds: Math.floor(uptime), formatted: formatUptime(uptime) },
      memory: memUsage
        ? {
            heapUsed: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100, // MB
            heapTotal:
              Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100, // MB
            external: Math.round((memUsage.external / 1024 / 1024) * 100) / 100, // MB
            rss: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100, // MB
          }
        : null,
      env: process.env.NODE_ENV,
      pid: process.pid,
    },

    // Health indicators. One threshold set is shared by component and
    // overall status. Database health is 'unknown' when no queries were
    // observed in the window (zero queries is not evidence of health).
    // Memory health is the V8 heap used/total ratio of this process, not
    // host memory pressure, and 'unknown' on Workers (no process metrics).
    health: (() => {
      const database = classifySlowQueryRate(totalQueries, slowQueryRate);
      const memory = classifyHeapRatio(memUsage);
      return { database, memory, overall: worstHealth(database, memory) };
    })(),
  });
});

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

type Health = 'healthy' | 'warning' | 'critical' | 'unknown';

const SLOW_QUERY_RATE_WARNING = 5;
const SLOW_QUERY_RATE_CRITICAL = 15;
const HEAP_RATIO_WARNING = 0.85;
const HEAP_RATIO_CRITICAL = 0.95;

function classifySlowQueryRate(totalQueries: number, rate: number): Health {
  if (totalQueries === 0) return 'unknown';
  if (rate > SLOW_QUERY_RATE_CRITICAL) return 'critical';
  if (rate > SLOW_QUERY_RATE_WARNING) return 'warning';
  return 'healthy';
}

function classifyHeapRatio(memUsage: NodeJS.MemoryUsage | null): Health {
  if (!memUsage || memUsage.heapTotal <= 0) return 'unknown';
  const ratio = memUsage.heapUsed / memUsage.heapTotal;
  if (ratio > HEAP_RATIO_CRITICAL) return 'critical';
  if (ratio > HEAP_RATIO_WARNING) return 'warning';
  return 'healthy';
}

const HEALTH_SEVERITY: Record<Health, number> = {
  healthy: 0,
  unknown: 1,
  warning: 2,
  critical: 3,
};

function worstHealth(...statuses: Health[]): Health {
  return statuses.reduce((worst, status) =>
    HEALTH_SEVERITY[status] > HEALTH_SEVERITY[worst] ? status : worst
  );
}
