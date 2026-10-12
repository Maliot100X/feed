/**
 * Cron Metrics Dashboard API
 *
 * @route GET /api/admin/cron-metrics - Get cron job metrics
 * @access Admin
 *
 * @description
 * Returns metrics and alerts for all cron jobs. Used for monitoring
 * dashboards and operational visibility.
 *
 * @returns Dashboard metrics with job stats, summary, and active alerts
 */

import {
  cronMetrics,
  requirePermission,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/cron-metrics
 *
 * Returns cron job metrics dashboard data including:
 * - Individual job statistics
 * - Summary metrics
 * - Active alerts
 *
 * Metrics are recorded in memory by the process that ran each cron job, so
 * this view only covers executions observed by the serving process
 * (`scope: 'process'`). An empty or quiet dashboard does not prove that
 * cron jobs are healthy platform-wide.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  // Same capability as the canonical system status endpoint
  await requirePermission(request, 'view_system');

  const dashboard = cronMetrics.getDashboardMetrics();

  return successResponse({
    timestamp: new Date().toISOString(),
    scope: 'process',
    ...dashboard,
  });
});
