#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const environment = process.argv[2];
if (environment !== 'staging' && environment !== 'production') {
  throw new Error('Usage: bun run build:cloudflare staging|production');
}
const app = resolve(import.meta.dir, '../apps/web');
const buildEnvironment: Record<string, string> = JSON.parse(
  process.env.CLOUDFLARE_BUILD_ENV || '{}'
);
for (const [name, value] of Object.entries(buildEnvironment)) {
  if (!name.startsWith('NEXT_PUBLIC_') || typeof value !== 'string') {
    throw new Error(
      'Cloudflare build settings must be public string variables'
    );
  }
}
const result = spawnSync(
  'bun',
  [
    'x',
    'opennextjs-cloudflare',
    'build',
    '--config',
    `wrangler.${environment}.jsonc`,
  ],
  {
    cwd: app,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...buildEnvironment,
      DEPLOYMENT_PLATFORM: 'cloudflare',
      DEPLOYMENT_ENV: environment,
      NEXT_PUBLIC_DEPLOYMENT_ENV: environment,
      NEXT_PUBLIC_COMMIT_SHA: process.env.COMMIT_SHA ?? '',
      DISABLE_SENTRY: 'true',
      NEXT_PUBLIC_DISABLE_SENTRY: 'true',
      NEXT_PUBLIC_APP_URL:
        environment === 'production'
          ? 'https://feed.fun'
          : 'https://staging.feed.fun',
      NEXT_PUBLIC_API_URL:
        environment === 'production'
          ? 'https://feed.fun'
          : 'https://staging.feed.fun',
    },
  }
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const budget = spawnSync(
  'bun',
  [resolve(import.meta.dir, 'cloudflare/check-bundle.ts'), environment],
  { stdio: 'inherit', env: process.env }
);
if (budget.error) throw budget.error;
process.exit(budget.status ?? 1);
