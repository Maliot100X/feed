import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCloudflareAlertReservations } from '../../api/src/services/cloudflare-alert-reservations';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflareAlertReservations((body) =>
  fetch(endpoint, { method: 'POST', body })
);
let stateDirectory: string;
let endpoint: string;
let processHandle: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
let diagnostics: Promise<string> | undefined;
async function call(body: object): Promise<Response> {
  return fetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
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
      'packages/testing/fixtures/cloudflare-alert-reservations/wrangler.toml',
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
      body: JSON.stringify({
        operation: 'release',
        fingerprint: '0'.repeat(64),
        token: '00000000-0000-4000-8000-000000000000',
      }),
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-alert-reservations-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

const fingerprint = 'a'.repeat(64);
let owner: string;

test('one concurrent reservation wins and persists across restart without extending its window', async () => {
  const before = Date.now();
  const results = await Promise.all(
    Array.from({ length: 30 }, () => backend.reserve(fingerprint, 1800))
  );
  const winners = results.filter((token): token is string => token !== null);
  expect(winners).toHaveLength(1);
  owner = winners[0]!;
  await stop();
  let checked = false;
  for await (const file of new Bun.Glob('**/*.sqlite').scan({
    cwd: stateDirectory,
    absolute: true,
  })) {
    const db = new Database(file);
    try {
      if (
        !db
          .query(
            "SELECT name FROM sqlite_master WHERE name='alert_reservations'"
          )
          .get()
      )
        continue;
      const row = db
        .query<{ expires_at: number }, [string]>(
          'SELECT expires_at FROM alert_reservations WHERE fingerprint=?'
        )
        .get(fingerprint);
      expect(row?.expires_at).toBeGreaterThanOrEqual(before + 1800_000);
      expect(row?.expires_at).toBeLessThanOrEqual(Date.now() + 1800_000);
      checked = true;
    } finally {
      db.close();
    }
  }
  expect(checked).toBe(true);
  await start();
  expect(await backend.reserve(fingerprint, 1)).toBeNull();
  expect(await backend.reserve('b'.repeat(64), 1800)).not.toBeNull();
}, 60_000);

test('only the owner can release a failed alert reservation', async () => {
  await backend.release(fingerprint, crypto.randomUUID());
  expect(await backend.reserve(fingerprint, 1800)).toBeNull();
  await backend.release(fingerprint, owner);
  const replacement = await backend.reserve(fingerprint, 1800);
  expect(replacement).not.toBeNull();
  await backend.release(fingerprint, owner);
  expect(await backend.reserve(fingerprint, 1800)).toBeNull();
  owner = replacement!;
});

test('expiration permits a new owner while late release cannot remove it', async () => {
  await stop();
  let updated = false;
  for await (const file of new Bun.Glob('**/*.sqlite').scan({
    cwd: stateDirectory,
    absolute: true,
  })) {
    const db = new Database(file);
    try {
      if (
        !db
          .query(
            "SELECT name FROM sqlite_master WHERE name='alert_reservations'"
          )
          .get()
      )
        continue;
      updated =
        db
          .query(
            'UPDATE alert_reservations SET expires_at=? WHERE fingerprint=?'
          )
          .run(Date.now() - 1, fingerprint).changes === 1;
    } finally {
      db.close();
    }
  }
  expect(updated).toBe(true);
  await start();
  const replacement = await backend.reserve(fingerprint, 1800);
  expect(replacement).not.toBeNull();
  await backend.release(fingerprint, owner);
  expect(await backend.reserve(fingerprint, 1800)).toBeNull();
  expect(await backend.reserve('b'.repeat(64), 1800)).toBeNull();
}, 60_000);

test('invalid incident identities and TTLs are rejected', async () => {
  await expect(backend.reserve('bad', 1800)).rejects.toThrow('HTTP 400');
  await expect(backend.reserve(fingerprint, 0)).rejects.toThrow('HTTP 400');
  await expect(backend.reserve(fingerprint, 1801)).rejects.toThrow('HTTP 400');
  expect(
    (await call({ operation: 'release', fingerprint, token: 'invalid' })).status
  ).toBe(400);
});
