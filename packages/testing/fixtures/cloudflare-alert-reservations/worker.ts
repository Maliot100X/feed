import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedAlertReservations } from '../../../api/src/services/cloudflare-alert-reservations-object';
export default {
  fetch(request: Request, env: { ALERT_RESERVATIONS: DurableObjectNamespace }) {
    return env.ALERT_RESERVATIONS.get(
      env.ALERT_RESERVATIONS.idFromName('acceptance')
    ).fetch(request);
  },
};
