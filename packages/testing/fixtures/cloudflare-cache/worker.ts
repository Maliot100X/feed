import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedCache } from '../../../api/src/cache/cloudflare-cache-object';
export default {
  fetch(request: Request, env: { CACHE: DurableObjectNamespace }) {
    return env.CACHE.get(env.CACHE.idFromName('acceptance')).fetch(request);
  },
};
