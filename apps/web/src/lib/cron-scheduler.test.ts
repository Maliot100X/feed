import { afterEach, describe, expect, it } from 'bun:test';
import { isInternalCronSchedulerEnabled } from './cron-scheduler';

const env = process.env as Record<string, string | undefined>;
const saved = {
  DEPLOYMENT_PLATFORM: env.DEPLOYMENT_PLATFORM,
  ENABLE_INTERNAL_CRON_SCHEDULER: env.ENABLE_INTERNAL_CRON_SCHEDULER,
  NODE_ENV: env.NODE_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe('isInternalCronSchedulerEnabled', () => {
  it('is off on hosted production unless explicitly enabled', () => {
    delete env.DEPLOYMENT_PLATFORM;
    delete env.ENABLE_INTERNAL_CRON_SCHEDULER;
    env.NODE_ENV = 'production';
    expect(isInternalCronSchedulerEnabled()).toBe(false);
    env.ENABLE_INTERNAL_CRON_SCHEDULER = 'true';
    expect(isInternalCronSchedulerEnabled()).toBe(true);
  });

  it('defaults on in local development and never runs on Cloudflare', () => {
    delete env.ENABLE_INTERNAL_CRON_SCHEDULER;
    env.NODE_ENV = 'development';
    delete env.DEPLOYMENT_PLATFORM;
    expect(isInternalCronSchedulerEnabled()).toBe(true);
    env.DEPLOYMENT_PLATFORM = 'cloudflare';
    env.ENABLE_INTERNAL_CRON_SCHEDULER = 'true';
    expect(isInternalCronSchedulerEnabled()).toBe(false);
  });
});
