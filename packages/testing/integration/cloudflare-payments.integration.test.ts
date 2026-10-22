import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createCloudflarePaymentStorage,
  PAYMENT_STORAGE_RESOURCE,
} from '../../a2a/src/payments/cloudflare-backend';
import { getSharedX402Manager } from '../../a2a/src/payments/shared-manager';
import {
  requestResource,
  withRequestResources,
} from '../../shared/src/server/request-scope';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflarePaymentStorage((body) =>
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
      'packages/testing/fixtures/cloudflare-payments/wrangler.toml',
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
      body: JSON.stringify({ operation: 'get', key: 'x402:payment:ready' }),
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-payments-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

test('transaction claims have one winner across concurrent requests and survive restart', async () => {
  const key = 'x402:tx:shared-transaction';
  const contenders = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      backend.setIfAbsent(key, `request-${index}`, 90 * 24 * 60 * 60)
    )
  );
  expect(contenders.filter(Boolean)).toHaveLength(1);
  const winner = `request-${contenders.indexOf(true)}`;
  expect(await backend.get(key)).toBe(winner);
  await stop();
  await start();
  expect(await backend.get(key)).toBe(winner);
  expect(await backend.setIfAbsent(key, 'another-request', 900)).toBe(false);
  expect(await backend.get(key)).toBe(winner);
}, 60_000);

test('payment requests retain their values independently of transaction claims', async () => {
  await backend.set('x402:payment:first', '{"request":"first"}', { ex: 900 });
  await backend.set('x402:payment:second', '{"request":"second"}', { ex: 900 });
  expect(await backend.get('x402:payment:first')).toBe('{"request":"first"}');
  expect(await backend.keys('x402:payment:*')).toEqual([
    'x402:payment:first',
    'x402:payment:second',
  ]);
  await backend.del('x402:payment:first');
  expect(await backend.get('x402:payment:first')).toBeNull();
  expect(await backend.get('x402:payment:second')).toBe('{"request":"second"}');
  expect(await backend.get('x402:tx:shared-transaction')).not.toBeNull();
});

test('expired claims release ownership, while failed duplicate claims do not shorten expiry', async () => {
  await backend.setIfAbsent('x402:tx:expired', 'old-owner', 900);
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
          .query("SELECT name FROM sqlite_master WHERE name='payment_state'")
          .get()
      )
        continue;
      updated =
        db
          .query('UPDATE payment_state SET expires_at=? WHERE key=?')
          .run(Date.now() - 1, 'x402:tx:expired').changes === 1;
      const row = db
        .query<{ expires_at: number }, [string]>(
          'SELECT expires_at FROM payment_state WHERE key=?'
        )
        .get('x402:tx:shared-transaction');
      expect(row?.expires_at).toBeGreaterThan(
        Date.now() + 89 * 24 * 60 * 60 * 1000
      );
    } finally {
      db.close();
    }
  }
  expect(updated).toBe(true);
  await start();
  expect(await backend.get('x402:tx:expired')).toBeNull();
  expect(await backend.setIfAbsent('x402:tx:expired', 'new-owner', 900)).toBe(
    true
  );
  expect(await backend.get('x402:tx:expired')).toBe('new-owner');
}, 60_000);

test('invalid key namespaces and expiry fail closed', async () => {
  await expect(
    backend.setIfAbsent('unrelated:key', 'value', 900)
  ).rejects.toThrow('HTTP 400');
  await expect(
    backend.setIfAbsent('x402:tx:invalid', 'value', 0)
  ).rejects.toThrow('HTTP 400');
  await expect(
    backend.setIfAbsent('x402:tx:invalid', 'value', 1.5)
  ).rejects.toThrow('HTTP 400');
  await expect(backend.keys('*')).rejects.toThrow('HTTP 400');
  expect(await backend.get('x402:tx:invalid')).toBeNull();
  expect(
    (
      await call({
        operation: 'get',
        key: 'x402:payment:missing',
        unexpected: true,
      })
    ).status
  ).toBe(400);
});

test('shared managers in separate request scopes use durable payment storage and require the binding', async () => {
  const previous = process.env.PAYMENT_STORAGE_BACKEND;
  process.env.PAYMENT_STORAGE_BACKEND = 'cloudflare';
  const tasks: Promise<unknown>[] = [];
  try {
    await expect(getSharedX402Manager()).rejects.toThrow('binding unavailable');
    let requestId = '';
    await withRequestResources(
      async () => {
        requestResource(PAYMENT_STORAGE_RESOURCE, () => backend);
        const manager = await getSharedX402Manager();
        const payment = await manager.createPaymentRequest(
          '0x0000000000000000000000000000000000000001',
          '0x0000000000000000000000000000000000000002',
          '1000000000000000',
          'local-storage-test',
          {}
        );
        requestId = payment.requestId;
        return new Response(null);
      },
      (task) => tasks.push(task)
    );
    await withRequestResources(
      async () => {
        requestResource(PAYMENT_STORAGE_RESOURCE, () => backend);
        const manager = await getSharedX402Manager();
        expect((await manager.getPaymentRequest(requestId))?.service).toBe(
          'local-storage-test'
        );
        expect(await manager.isPaymentVerified(requestId)).toBe(false);
        expect(await manager.cancelPaymentRequest(requestId)).toBe(true);
        return new Response(null);
      },
      (task) => tasks.push(task)
    );
    expect(await backend.get(`x402:payment:${requestId}`)).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_STORAGE_BACKEND;
    else process.env.PAYMENT_STORAGE_BACKEND = previous;
    await Promise.all(tasks);
  }
});
