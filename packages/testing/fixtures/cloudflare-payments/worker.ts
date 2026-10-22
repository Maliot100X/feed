import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedPayments } from '../../../a2a/src/payments/cloudflare-object';
export default {
  fetch(request: Request, env: { PAYMENTS: DurableObjectNamespace }) {
    return env.PAYMENTS.get(env.PAYMENTS.idFromName('acceptance')).fetch(
      request
    );
  },
};
