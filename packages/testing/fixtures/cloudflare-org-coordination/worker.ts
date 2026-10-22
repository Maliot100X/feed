import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedOrgCoordination } from '../../../api/src/services/cloudflare-org-coordination-object';
export default {
  fetch(request: Request, env: { ORG_COORDINATION: DurableObjectNamespace }) {
    return env.ORG_COORDINATION.get(
      env.ORG_COORDINATION.idFromName('acceptance')
    ).fetch(request);
  },
};
