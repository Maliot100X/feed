import { type CronJob, dueJobs, isCronJob } from './schedule';

interface Env {
  APP: Fetcher;
  JOBS: Queue<CronJob>;
  APP_ORIGIN: string;
  CRON_SECRET: string;
  CRON_ENABLED: string;
}

export default {
  async scheduled(event: ScheduledController, env: Env) {
    if (env.CRON_ENABLED !== 'true') return;
    if (!env.CRON_SECRET) throw new Error('CRON_SECRET is required');
    const batch = dueJobs(event.scheduledTime).map(({ path }) => ({
      body: { path, scheduledTime: event.scheduledTime },
    }));
    if (batch.length) await env.JOBS.sendBatch(batch);
  },

  async queue(batch: MessageBatch<CronJob>, env: Env) {
    for (const message of batch.messages) {
      // Pause queued work as well as the producer during a cutover/rollback.
      if (env.CRON_ENABLED !== 'true') {
        message.retry({ delaySeconds: 300 });
        continue;
      }
      if (!env.CRON_SECRET || !isCronJob(message.body)) {
        throw new Error('Invalid cron configuration or queue message');
      }
      const { path, scheduledTime } = message.body;
      const response = await env.APP.fetch(
        new Request(new URL(path, env.APP_ORIGIN), {
          headers: {
            Authorization: `Bearer ${env.CRON_SECRET}`,
            'X-Cloudflare-Cron-Time': String(scheduledTime),
          },
          signal: AbortSignal.timeout(840_000),
        })
      );
      // Consume the stream before acknowledging: completion may include deferred work.
      await response.arrayBuffer();
      if (!response.ok)
        throw new Error(`Cron ${path} returned HTTP ${response.status}`);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, CronJob>;
