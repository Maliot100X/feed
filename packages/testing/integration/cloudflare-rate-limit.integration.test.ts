import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCloudflareRateLimitBackend } from '../../api/src/rate-limiting/cloudflare-backend';

const root = resolve(import.meta.dir, '../../..');
let stateDirectory: string;
let endpoint: string;
let processHandle: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
let diagnostics: Promise<string> | undefined;
const config = { actionType: 'write', windowMs: 120_000, maxRequests: 5 };
const backend = createCloudflareRateLimitBackend((body) =>
  fetch(endpoint, { method: 'POST', body })
);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (!address || typeof address === 'string') throw new Error('No test port');
  return address.port;
}

async function start(): Promise<void> {
  const port = await availablePort();
  endpoint = `http://127.0.0.1:${port}`;
  processHandle = Bun.spawn(
    [
      'bun',
      'x',
      '--no-install',
      'wrangler',
      'dev',
      '--local',
      '--config',
      'packages/testing/fixtures/cloudflare-rate-limit/wrangler.toml',
      '--port',
      String(port),
      '--persist-to',
      stateDirectory,
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  diagnostics = Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]).then((logs) => logs.join('\n'));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null)
      throw new Error(`Local Workerd exited: ${await diagnostics}`);
    const response = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ operation: 'status', userId: 'ready', ...config }),
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (response?.ok) return;
    await response?.body?.cancel();
    await Bun.sleep(100);
  }
  throw new Error('Local Workerd did not become ready');
}

async function stop(): Promise<void> {
  if (processHandle) {
    processHandle.kill('SIGTERM');
    await processHandle.exited;
    await diagnostics;
    processHandle = undefined;
  }
}

beforeAll(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-rate-limit-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

test('atomic admission survives Workerd restart and remains isolated', async () => {
  const admissions = await Promise.all(
    Array.from({ length: 24 }, () => backend.check('alice', config))
  );
  expect(admissions.filter((result) => result.allowed)).toHaveLength(5);
  const before = await backend.status('alice', config);
  expect(before.count).toBe(5);
  expect((await backend.check('bob', config)).allowed).toBe(true);
  expect(
    (await backend.check('alice', { ...config, actionType: 'read' })).allowed
  ).toBe(true);
  await stop();
  await start();
  expect(await backend.status('alice', config)).toEqual(before);
  expect((await backend.check('alice', config)).allowed).toBe(false);
  await backend.reset('alice', config.actionType);
  expect((await backend.status('alice', config)).count).toBe(0);
  expect((await backend.status('bob', config)).count).toBe(1);
}, 60_000);

test('expired windows admit again and invalid windows fail closed', async () => {
  const short = {
    ...config,
    actionType: 'expiry',
    windowMs: 100,
    maxRequests: 1,
  };
  expect((await backend.check('expiry-user', short)).allowed).toBe(true);
  expect((await backend.check('expiry-user', short)).allowed).toBe(false);
  await Bun.sleep(150);
  expect((await backend.check('expiry-user', short)).allowed).toBe(true);
  for (const windowMs of [0, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_000]) {
    await expect(
      backend.check('invalid', { ...config, windowMs })
    ).rejects.toThrow('HTTP 400');
  }
  await backend.clear();
  expect((await backend.status('bob', config)).count).toBe(0);
});

test('unavailable durable storage rejects instead of admitting in memory', async () => {
  await stop();
  await expect(backend.check('offline', config)).rejects.toThrow();
});
