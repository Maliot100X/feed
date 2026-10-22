import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedApiKeyUsage } from '../../../api/src/utils/cloudflare-api-key-usage-object';
export default {
  fetch(request: Request, env: { API_KEY_USAGE: DurableObjectNamespace }) {
    return env.API_KEY_USAGE.get(
      env.API_KEY_USAGE.idFromName('acceptance')
    ).fetch(request);
  },
};
