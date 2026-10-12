import {
  drainOutboxBatch,
  flushLastUsedUpdates,
  requireCronAuth,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Security: Verify cron authorization
  requireCronAuth(request, { jobName: 'RealtimeDrain' });

  if (process.env.DEPLOYMENT_PLATFORM === 'cloudflare') {
    await flushLastUsedUpdates();
  }
  const result = await drainOutboxBatch();
  logger.info('Realtime outbox drain completed', result, 'Realtime');
  return successResponse({
    // Failed deliveries are retried by later drains, but this run did not
    // fully succeed.
    success: result.failed === 0,
    ...result,
    timestamp: Date.now(),
  });
});
