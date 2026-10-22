import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  clearAllCache,
  getCache,
  getCacheBatch,
  getCacheOrFetch,
  invalidateCache,
  invalidateCachePattern,
  setCache,
  setCacheBatch,
} from '../../api/src/cache/cache-service';
import {
  CACHE_RESOURCE,
  createCloudflareCache,
} from '../../api/src/cache/cloudflare-cache-backend';
import {
  requestResource,
  withRequestResources,
} from '../../shared/src/server/request-scope';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflareCache((body) =>
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
      'packages/testing/fixtures/cloudflare-cache/wrangler.toml',
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
      body: JSON.stringify({ operation: 'get', key: 'ready' }),
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-cache-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

async function inScope(run: () => Promise<void>) {
  const tasks: Promise<unknown>[] = [];
  await withRequestResources(
    async () => {
      requestResource(CACHE_RESOURCE, () => backend);
      await run();
      return new Response(null);
    },
    (task) => tasks.push(task)
  );
  await Promise.all(tasks);
}

test('large Unicode and BigInt cache values survive restart and batch operations preserve keys', async () => {
  const value = {
    text: '🙂'.repeat(700_000),
    amount: 1234567890123456789012345n,
  };
  await inScope(async () => {
    await setCache('large', value, { namespace: 'account:a', ttl: 300 });
    await setCacheBatch(
      new Map([
        ['one', { n: 1 }],
        ['two', { n: 2 }],
      ]),
      { namespace: 'batch' }
    );
  });
  await stop();
  await start();
  await inScope(async () => {
    expect(
      await getCache<{ text: string; amount: bigint }>('large', {
        namespace: 'account:a',
      })
    ).toEqual(value);
    expect(
      await getCache<{ text: string; amount: bigint }>('large', {
        namespace: 'account:b',
      })
    ).toBeNull();
    const entries = await getCacheBatch(['two', 'missing', 'one'], {
      namespace: 'batch',
    });
    expect(Array.from(entries.entries())).toEqual([
      ['two', { n: 2 }],
      ['one', { n: 1 }],
    ]);
  });
  expect(await backend.ttl('account:a:large')).toBeGreaterThan(0);
  expect(await backend.ttl('account:a:large')).toBeLessThanOrEqual(300);
}, 60000);

test('namespace-aware exact and pattern invalidation do not remove other accounts', async () => {
  await inScope(async () => {
    await setCacheBatch(
      [
        ['item:1', 1],
        ['item:2', 2],
        ['a.b', 3],
        ['axb', 4],
      ],
      { namespace: 'alice' }
    );
    await setCache('item:1', 5, { namespace: 'bob' });
    await invalidateCachePattern('item:?', { namespace: 'alice' });
    expect(await getCache<number>('item:1', { namespace: 'alice' })).toBeNull();
    expect(await getCache<number>('item:2', { namespace: 'alice' })).toBeNull();
    expect(await getCache<number>('item:1', { namespace: 'bob' })).toBe(5);
    await invalidateCachePattern('a.b', { namespace: 'alice' });
    expect(await getCache<number>('a.b', { namespace: 'alice' })).toBeNull();
    expect(await getCache<number>('axb', { namespace: 'alice' })).toBe(4);
    await invalidateCache('axb', { namespace: 'alice' });
    expect(await getCache<number>('axb', { namespace: 'alice' })).toBeNull();
  });
});

test('expired values and chunks are removed and clear survives restart', async () => {
  await backend.setMany([['expired', 'value']], 300);
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
          .query("SELECT name FROM sqlite_master WHERE name='cache_entries'")
          .get()
      )
        continue;
      updated =
        db
          .query("UPDATE cache_entries SET expires_at=? WHERE key='expired'")
          .run(Date.now() - 1).changes === 1;
    } finally {
      db.close();
    }
  }
  expect(updated).toBe(true);
  await start();
  expect(await backend.get('expired')).toBeNull();
  expect(await backend.ttl('expired')).toBe(-2);
  await inScope(async () => {
    await clearAllCache();
  });
  await stop();
  await start();
  expect(await backend.get('bob:item:1')).toBeNull();
}, 60000);

test('cache-aside refresh remains alive after response and storage errors fail explicitly', async () => {
  const tasks: Promise<unknown>[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshed = false;
  const random = Math.random;
  try {
    await withRequestResources(
      async () => {
        requestResource(CACHE_RESOURCE, () => backend);
        expect(
          await getCacheOrFetch('refresh', async () => ({ version: 1 }))
        ).toEqual({ version: 1 });
        Math.random = () => 0;
        expect(
          await getCacheOrFetch('refresh', async () => {
            await gate;
            refreshed = true;
            return { version: 2 };
          })
        ).toEqual({ version: 1 });
        return new Response(null);
      },
      (task) => tasks.push(task)
    );
    expect(refreshed).toBe(false);
    release();
    await Promise.all(tasks);
    expect(refreshed).toBe(true);
    await inScope(async () => {
      expect(await getCache<{ version: number }>('refresh')).toEqual({
        version: 2,
      });
    });
  } finally {
    Math.random = random;
    release();
    await Promise.all(tasks);
  }
  await expect(backend.setMany([['bad', 'value']], -1)).rejects.toThrow(
    'HTTP 400'
  );
  expect(
    (await call({ operation: 'set', entries: [['bad', 'value']], ttl: 1.5 }))
      .status
  ).toBe(400);
  const previous = process.env.CACHE_BACKEND;
  process.env.CACHE_BACKEND = 'cloudflare';
  try {
    await expect(getCache<{ version: number }>('refresh')).rejects.toThrow(
      'binding unavailable'
    );
  } finally {
    if (previous === undefined) delete process.env.CACHE_BACKEND;
    else process.env.CACHE_BACKEND = previous;
  }
});
