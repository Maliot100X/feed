import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCloudflareDeviceRegistry } from '../../api/src/notifications/device-registry';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflareDeviceRegistry((body) =>
  fetch(endpoint, { method: 'POST', body })
);
let stateDirectory: string;
let endpoint: string;
let processHandle: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
let diagnostics: Promise<string> | undefined;
async function call(body: object): Promise<Response> {
  return fetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
}
async function list(userId: string) {
  const response = await call({ operation: 'list', userId });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    devices: { token: string; platform: string; updatedAt: number }[];
    expiresAt: number | null;
  }>;
}

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
      'packages/testing/fixtures/cloudflare-devices/wrangler.toml',
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
      body: JSON.stringify({ operation: 'list', userId: 'ready' }),
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-devices-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

test('concurrent registrations, token deduplication, user isolation, and logout survive restart', async () => {
  const before = Date.now();
  const registered = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      call({
        operation: 'register',
        userId: 'alice',
        platform: 'ios',
        token: `device-${index}`,
      })
    )
  );
  expect(registered.every((response) => response.status === 200)).toBe(true);
  expect(
    (
      await call({
        operation: 'register',
        userId: 'alice',
        platform: 'android',
        token: 'device-0',
      })
    ).status
  ).toBe(200);
  expect(
    (
      await call({
        operation: 'register',
        userId: 'bob',
        platform: 'ios',
        token: 'device-0',
      })
    ).status
  ).toBe(200);
  const alice = await list('alice');
  expect(alice.devices).toHaveLength(20);
  expect(
    alice.devices.find((device) => device.token === 'device-0')?.platform
  ).toBe('android');
  expect(alice.expiresAt).toBeGreaterThanOrEqual(
    before + 90 * 24 * 60 * 60 * 1000
  );
  expect(alice.expiresAt).toBeLessThanOrEqual(
    Date.now() + 90 * 24 * 60 * 60 * 1000
  );
  expect((await list('bob')).devices).toHaveLength(1);
  await stop();
  await start();
  expect(await list('alice')).toEqual(alice);
  expect((await call({ operation: 'remove', userId: 'alice' })).status).toBe(
    200
  );
  expect(await list('alice')).toEqual({ devices: [], expiresAt: null });
  expect((await list('bob')).devices).toHaveLength(1);
}, 60_000);

test('invalid operations cannot write records', async () => {
  for (const body of [
    {
      operation: 'register',
      userId: 'invalid',
      platform: 'unknown',
      token: 'token',
    },
    { operation: 'register', userId: 'invalid', platform: 'ios', token: '' },
    {
      operation: 'register',
      userId: 'invalid',
      platform: 'ios',
      token: 'x'.repeat(4097),
    },
    { operation: 'remove', userId: '' },
  ])
    expect((await call(body)).status).toBe(400);
  await expect(
    backend.register({ userId: 'invalid', platform: 'ios', token: '' })
  ).rejects.toThrow('HTTP 400');
  await backend.register({
    userId: 'transport',
    platform: 'android',
    token: 'transport-token',
  });
  expect((await list('transport')).devices).toHaveLength(1);
  await backend.remove('transport');
  expect(await list('transport')).toEqual({ devices: [], expiresAt: null });
  expect(await list('invalid')).toEqual({ devices: [], expiresAt: null });
});

test('expired user hashes are removed without expiring another account', async () => {
  await backend.register({
    userId: 'expired',
    platform: 'ios',
    token: 'old-token',
  });
  await backend.register({
    userId: 'retained',
    platform: 'ios',
    token: 'current-token',
  });
  await stop();
  // Advance this stored account to its expiry boundary using the real persisted
  // SQLite database while Workerd is stopped; production has no test clock.
  let updated = false;
  for await (const file of new Bun.Glob('**/*.sqlite').scan({
    cwd: stateDirectory,
    absolute: true,
  })) {
    const db = new Database(file);
    try {
      if (
        !db
          .query("SELECT name FROM sqlite_master WHERE name='device_users'")
          .get()
      )
        continue;
      const result = db
        .query('UPDATE device_users SET expires_at=? WHERE user_id=?')
        .run(Date.now() - 1, 'expired');
      updated = result.changes === 1;
    } finally {
      db.close();
    }
  }
  expect(updated).toBe(true);
  await start();
  expect(await list('expired')).toEqual({ devices: [], expiresAt: null });
  expect((await list('retained')).devices).toHaveLength(1);
  await backend.register({
    userId: 'expired',
    platform: 'android',
    token: 'new-token',
  });
  const renewed = await list('expired');
  expect(renewed.devices.map((device) => device.token)).toEqual(['new-token']);
}, 60_000);
