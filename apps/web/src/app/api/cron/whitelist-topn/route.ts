/**
 * Whitelist Top N Cron Job
 *
 * @route GET/POST /api/cron/whitelist-topn
 * @access Cron (CRON_SECRET required)
 *
 * @description
 * Runs daily at 00:00 UTC (via the Cloudflare cron Worker) and permanently whitelists any
 * users in the current leaderboard Top N (category: all) who have never been
 * seen before.
 *
 * This implements: "reach Top N at any time => keep access".
 *
 * Important: revoked whitelist entries are never re-activated by this job.
 */

import {
  recordCronExecution,
  requireCronAuth,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { autoWhitelistCurrentTopN } from '@feed/api/services/whitelist-service';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: NextRequest) => {
  const startTime = new Date();
  requireCronAuth(request, { jobName: 'WhitelistTopNCron' });

  const result = await autoWhitelistCurrentTopN();

  recordCronExecution('whitelist-topn', startTime, {
    success: true,
    ...result,
  });

  return successResponse({
    success: true,
    ...result,
  });
});

// Cron schedulers may use GET; it runs the same authenticated handler.
export const GET = POST;
