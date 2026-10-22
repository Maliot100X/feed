import type {
  DurableObjectNamespace,
  Request,
} from '@cloudflare/workers-types';

export { FeedTasks } from '../../../a2a/src/cloudflare-task-object';
export default {
  fetch(request: Request, env: { TASKS: DurableObjectNamespace }) {
    return env.TASKS.get(env.TASKS.idFromName('acceptance')).fetch(request);
  },
};
