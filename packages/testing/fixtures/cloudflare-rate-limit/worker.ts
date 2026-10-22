import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedRateLimits } from '../../../api/src/rate-limiting/cloudflare-object';

export default {
  fetch(request: Request, env: { RATE_LIMITS: DurableObjectNamespace }) {
    return env.RATE_LIMITS.get(env.RATE_LIMITS.idFromName('acceptance')).fetch(
      request
    );
  },
};
