#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const environment = process.argv[2];
if (environment !== 'staging' && environment !== 'production')
  throw new Error('Specify staging or production');
const root = resolve(import.meta.dir, '../..');
const runtime: Record<string, string> = JSON.parse(
  process.env.CLOUDFLARE_RUNTIME_SECRETS || '{}'
);
for (const [name, value] of Object.entries(runtime)) {
  if (typeof value !== 'string')
    throw new Error(`Runtime secret ${name} must be a string`);
  if (
    /^(VERCEL_|BLOB_|KV_|ELIZACLOUD_|GROQ_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$)/.test(
      name
    )
  ) {
    throw new Error(
      `Legacy provider setting ${name} must be migrated explicitly`
    );
  }
}
// The Worker derives DATABASE_URL from its Hyperdrive binding on every request.
if (runtime.DATABASE_URL || process.env.DATABASE_URL)
  throw new Error(
    'DATABASE_URL must not be a Worker secret; configure the HYPERDRIVE binding'
  );
for (const name of [
  'CRON_SECRET',
  'SURPLUS_API_KEY',
  'STEWARD_JWT_SECRET',
  'STEWARD_TENANT_API_KEY',
  'STEWARD_API_URL',
  'STEWARD_PLATFORM_KEYS',
  'AGENT_ENCRYPTION_KEY',
]) {
  const value = process.env[name] || runtime[name];
  if (!value) throw new Error(`Missing runtime secret: ${name}`);
  runtime[name] = value;
}
if (!runtime.REDIS_URL)
  throw new Error(
    'REDIS_URL is required for distributed caching and realtime delivery'
  );
if (new URL(runtime.STEWARD_API_URL!).protocol !== 'https:')
  throw new Error('STEWARD_API_URL must use HTTPS');
const sha = process.env.COMMIT_SHA;
if (!sha || !/^[a-f0-9]{40}$/.test(sha))
  throw new Error('COMMIT_SHA must be the tested full Git commit');

function run(cwd: string, command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed with exit ${result.status}`);
}
const dir = await mkdtemp(join(tmpdir(), 'feed-cloudflare-secrets-'));
try {
  const appSecrets = join(dir, 'app.json');
  const cronSecrets = join(dir, 'cron.json');
  await writeFile(appSecrets, JSON.stringify(runtime), { mode: 0o600 });
  await writeFile(
    cronSecrets,
    JSON.stringify({ CRON_SECRET: runtime.CRON_SECRET }),
    { mode: 0o600 }
  );
  run(join(root, 'apps/web'), 'bun', [
    'x',
    'opennextjs-cloudflare',
    'deploy',
    '--config',
    `wrangler.${environment}.jsonc`,
    '--secrets-file',
    appSecrets,
    '--var',
    `COMMIT_SHA:${sha}`,
  ]);
  run(root, 'bun', [
    'x',
    'wrangler',
    'deploy',
    '--config',
    `workers/cron/wrangler.${environment}.jsonc`,
    '--secrets-file',
    cronSecrets,
  ]);
} finally {
  await rm(dir, { recursive: true, force: true });
}

// Verify the immutable deployment identity on the provider URL before domain cutover.
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token)
  throw new Error('Cloudflare API credentials are required');
const subdomainResponse = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`,
  { headers: { Authorization: `Bearer ${token}` } }
);
if (!subdomainResponse.ok)
  throw new Error('Cannot determine Workers deployment URL');
const subdomainBody = (await subdomainResponse.json()) as {
  success: boolean;
  result: { subdomain: string };
};
if (!subdomainBody.success || !subdomainBody.result.subdomain)
  throw new Error('Workers subdomain is not configured');
const origin = `https://feed-web-${environment}.${subdomainBody.result.subdomain}.workers.dev`;
const identityResponse = await fetch(`${origin}/__deployment`, {
  signal: AbortSignal.timeout(30_000),
  cache: 'no-store',
});
if (!identityResponse.ok)
  throw new Error('Deployment identity endpoint failed');
const identity = (await identityResponse.json()) as {
  commit?: string;
  environment?: string;
  platform?: string;
};
if (
  identity.commit !== sha ||
  identity.environment !== environment ||
  identity.platform !== 'cloudflare'
)
  throw new Error('Live Worker does not match the selected deployment');
const health = await fetch(`${origin}/api/health`, {
  signal: AbortSignal.timeout(30_000),
});
if (!health.ok)
  throw new Error(`Live health check returned HTTP ${health.status}`);
await health.arrayBuffer();
console.info(`Verified ${sha} at ${origin}`);
