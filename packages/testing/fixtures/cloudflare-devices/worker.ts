import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedDevices } from '../../../api/src/notifications/cloudflare-object';
export default {
  fetch(request: Request, env: { DEVICES: DurableObjectNamespace }) {
    return env.DEVICES.get(env.DEVICES.idFromName('acceptance')).fetch(request);
  },
};
