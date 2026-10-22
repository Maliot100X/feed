import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { db, eq, userApiKeys } from '@feed/db';
import { flushLastUsedUpdates } from '../../api/src/utils/api-key-lastused-flusher';
import {
  hashApiKey,
  invalidateCachedKey,
  validateUserApiKey,
} from '../../api/src/utils/api-keys';
import {
  API_KEY_USAGE_RESOURCE,
  createCloudflareApiKeyUsage,
} from '../../api/src/utils/cloudflare-api-key-usage';
import {
  requestResource,
  withRequestResources,
} from '../../shared/src/server/request-scope';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflareApiKeyUsage((body) =>
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
      'packages/testing/fixtures/cloudflare-api-key-usage/wrangler.toml',
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
      body: JSON.stringify({ operation: 'batch', limit: 1 }),
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-api-key-usage-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

test('concurrent updates coalesce monotonically and survive restart until acknowledged', async () => {
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      backend.record({ keyId: 'same-key', timestamp: 1000 + index })
    )
  );
  expect(await backend.batch(100)).toEqual([
    { keyId: 'same-key', timestamp: 1029 },
  ]);
  await stop();
  await start();
  const batch = await backend.batch(100);
  expect(batch).toEqual([{ keyId: 'same-key', timestamp: 1029 }]);
  await backend.record({ keyId: 'same-key', timestamp: 1030 });
  await backend.acknowledge(batch);
  expect(await backend.batch(100)).toEqual([
    { keyId: 'same-key', timestamp: 1030 },
  ]);
  await backend.acknowledge(await backend.batch(100));
  expect(await backend.batch(100)).toEqual([]);
}, 60_000);

test('batching retains entries beyond the requested size and rejects invalid boundaries', async () => {
  await backend.record({ keyId: 'second', timestamp: 2000 });
  await backend.record({ keyId: 'first', timestamp: 1000 });
  expect(await backend.batch(1)).toEqual([{ keyId: 'first', timestamp: 1000 }]);
  await backend.acknowledge(await backend.batch(1));
  expect(await backend.batch(1)).toEqual([
    { keyId: 'second', timestamp: 2000 },
  ]);
  await expect(backend.batch(0)).rejects.toThrow('HTTP 400');
  await expect(backend.batch(1001)).rejects.toThrow('HTTP 400');
  expect(
    (await call({ operation: 'record', entry: { keyId: '', timestamp: 0 } }))
      .status
  ).toBe(400);
  await backend.acknowledge(await backend.batch(100));
});

test('real PostgreSQL flush retains a concurrent newer value and stale replay cannot regress lastUsedAt', async () => {
  const keyId = `cf-usage-${crypto.randomUUID()}`;
  const first = Date.parse('2026-01-01T00:00:00Z');
  const second = first + 60_000;
  await db.insert(userApiKeys).values({
    id: keyId,
    userId: `user-${keyId}`,
    keyHash: crypto.randomUUID(),
  });
  const tasks: Promise<unknown>[] = [];
  let injectNewer = true;
  let failAcknowledgement = false;
  const storage = {
    ...backend,
    async acknowledge(entries: Parameters<typeof backend.acknowledge>[0]) {
      if (injectNewer) {
        injectNewer = false;
        await backend.record({ keyId, timestamp: second });
      }
      if (failAcknowledgement) {
        failAcknowledgement = false;
        throw new Error('Injected acknowledgement transport failure');
      }
      await backend.acknowledge(entries);
    },
  };
  async function flush(): Promise<number> {
    let result = -1;
    await withRequestResources(
      async () => {
        requestResource(API_KEY_USAGE_RESOURCE, () => storage);
        result = await flushLastUsedUpdates();
        return new Response(null);
      },
      (task) => tasks.push(task)
    );
    await Promise.all(tasks);
    return result;
  }
  async function storedTime() {
    const rows = await db
      .select({ lastUsedAt: userApiKeys.lastUsedAt })
      .from(userApiKeys)
      .where(eq(userApiKeys.id, keyId));
    return rows[0]?.lastUsedAt?.getTime();
  }
  try {
    await backend.record({ keyId, timestamp: first });
    expect(await flush()).toBe(1);
    expect(await storedTime()).toBe(first);
    expect(await backend.batch(100)).toEqual([{ keyId, timestamp: second }]);
    expect(await flush()).toBe(1);
    expect(await storedTime()).toBe(second);
    expect(await backend.batch(100)).toEqual([]);
    await backend.record({ keyId, timestamp: first });
    expect(await flush()).toBe(1);
    expect(await storedTime()).toBe(second);
    await backend.record({ keyId, timestamp: second + 60_000 });
    failAcknowledgement = true;
    await expect(flush()).rejects.toThrow(
      'Injected acknowledgement transport failure'
    );
    expect(await storedTime()).toBe(second + 60_000);
    expect(await backend.batch(100)).toEqual([
      { keyId, timestamp: second + 60_000 },
    ]);
    expect(await flush()).toBe(1);
    expect(await backend.batch(100)).toEqual([]);
  } finally {
    await db.delete(userApiKeys).where(eq(userApiKeys.id, keyId));
  }
});

test('authenticated usage reaches the durable buffer through the request lifetime', async () => {
  const keyId = `cf-auth-usage-${crypto.randomUUID()}`;
  const token = `local-fixture-${crypto.randomUUID()}`;
  const keyHash = hashApiKey(token);
  const userId = `user-${keyId}`;
  const tasks: Promise<unknown>[] = [];
  await db.insert(userApiKeys).values({ id: keyId, userId, keyHash });
  try {
    const before = Date.now();
    await withRequestResources(
      async () => {
        requestResource(API_KEY_USAGE_RESOURCE, () => backend);
        expect(await validateUserApiKey(token)).toEqual({ userId });
        return new Response(null);
      },
      (task) => tasks.push(task)
    );
    await Promise.all(tasks);
    const entries = await backend.batch(100);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.keyId).toBe(keyId);
    expect(entries[0]?.timestamp).toBeGreaterThanOrEqual(before);
    await backend.acknowledge(entries);
  } finally {
    invalidateCachedKey(keyHash);
    await db.delete(userApiKeys).where(eq(userApiKeys.id, keyId));
  }
});
