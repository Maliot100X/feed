import {
  checkCloudflareState,
  createSharedStateHealth,
  SHARED_STATE_BACKENDS,
} from '../../../api/src/redis/shared-state-health';

export { FeedTasks } from '../../../a2a/src/cloudflare-task-object';
export { FeedPayments } from '../../../a2a/src/payments/cloudflare-object';
export { FeedCache } from '../../../api/src/cache/cloudflare-cache-object';
export { FeedDevices } from '../../../api/src/notifications/cloudflare-object';
export { FeedRateLimits } from '../../../api/src/rate-limiting/cloudflare-object';
export { FeedAlertReservations } from '../../../api/src/services/cloudflare-alert-reservations-object';
export { FeedOrgCoordination } from '../../../api/src/services/cloudflare-org-coordination-object';
export { FeedApiKeyUsage } from '../../../api/src/utils/cloudflare-api-key-usage-object';

import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedStreams } from '../../../api/src/redis/cloudflare-streams-object';
export default {
  async fetch(
    request: Request,
    env: Record<
      (typeof SHARED_STATE_BACKENDS)[number]['binding'],
      DurableObjectNamespace
    >
  ) {
    if (new URL(request.url).pathname === '/health-all') {
      const health = createSharedStateHealth(
        SHARED_STATE_BACKENDS.map((backend) => ({
          name: backend.binding,
          provider: 'cloudflare',
          async check() {
            const response = await env[backend.binding]
              .get(env[backend.binding].idFromName('acceptance'))
              .fetch('https://state.internal/', {
                method: 'POST',
                body: JSON.stringify({ operation: 'health' }),
              });
            return checkCloudflareState(response);
          },
        }))
      );
      return Response.json(await health.check());
    }
    return env.STREAMS.get(env.STREAMS.idFromName('acceptance')).fetch(request);
  },
};
