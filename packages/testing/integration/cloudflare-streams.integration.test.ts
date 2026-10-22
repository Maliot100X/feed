import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createCloudflareStreams,
  STREAMS_RESOURCE,
} from '../../api/src/redis/cloudflare-streams';
import { streamAdd, streamRead } from '../../api/src/redis/streams';
import {
  requestResource,
  withRequestResources,
} from '../../shared/src/server/request-scope';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflareStreams((body, signal) =>
  fetch(endpoint, { method: 'POST', body, signal })
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
      'packages/testing/fixtures/cloudflare-streams/wrangler.toml',
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
      body: JSON.stringify({ operation: 'health' }),
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-streams-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

async function waitForReaders(count: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await backend.health()).pendingReads === count) return;
    await Bun.sleep(20);
  }
  throw new Error(`Expected ${count} pending reads`);
}

test('concurrent appends preserve unique ordered cursors and complete payloads across restart', async () => {
  const ids = await Promise.all(
    Array.from({ length: 30 }, (_, i) => backend.add('alice', { index: i }))
  );
  expect(new Set(ids).size).toBe(30);
  const all = await backend.read(['alice'], ['0']);
  expect(all).toHaveLength(30);
  const values = all.map((row) => row.id.split('-').map(BigInt));
  for (let i = 1; i < values.length; i++)
    expect(
      values[i]![0]! > values[i - 1]![0]! ||
        (values[i]![0] === values[i - 1]![0] &&
          values[i]![1]! > values[i - 1]![1]!)
    ).toBe(true);
  expect(await backend.head('alice')).toBe(all[29]!.id);
  await backend.add('large', { text: '🙂'.repeat(700_000) });
  await stop();
  await start();
  expect(await backend.read(['alice'], ['0'])).toEqual(all);
  expect((await backend.read(['large'], ['0']))[0]?.payload.text).toBe(
    '🙂'.repeat(700_000)
  );
  expect(await backend.read(['alice'], [all[29]!.id])).toEqual([]);
}, 60000);

test('multi-stream reads, per-stream counts, cursor replay and explicit retention stay isolated', async () => {
  await backend.add('bob', { index: 1 });
  await backend.add('bob', { index: 2 });
  const rows = await backend.read(['alice', 'bob'], ['0', '0'], { count: 1 });
  expect(rows.map((row) => row.stream)).toEqual(['alice', 'bob']);
  const replay = await backend.read(['bob'], [rows[1]!.id]);
  expect(replay.map((row) => row.payload.index)).toEqual([2]);
  for (let i = 0; i < 5; i++) await backend.add('trimmed', { index: i }, 2);
  expect(
    (await backend.read(['trimmed'], ['0'])).map((row) => row.payload.index)
  ).toEqual([3, 4]);
  const removed = await backend.add('empty', { index: 0 }, 0);
  expect(await backend.read(['empty'], ['0'])).toEqual([]);
  expect(await backend.head('empty')).toBe(removed);
  expect(await backend.read(['alice'], ['99999999999999999999-0'])).toEqual([]);
  await expect(backend.read(['alice'], [])).rejects.toThrow('HTTP 400');
  expect(
    (await call({ operation: 'read', streams: ['alice'], ids: ['bad'] })).status
  ).toBe(400);
});

test('blocking reads wake on append, dollar snapshots do not replay history, and timeouts clean up', async () => {
  const read = backend.read(['bob'], ['$'], { block: 5000 });
  await waitForReaders(1);
  const id = await backend.add('bob', { index: 3 });
  expect((await read).map((row) => row.id)).toEqual([id]);
  await waitForReaders(0);
  const started = Date.now();
  expect(await backend.read(['bob'], [id], { block: 80 })).toEqual([]);
  expect(Date.now() - started).toBeGreaterThanOrEqual(60);
  await waitForReaders(0);
});

test('cancelling an indefinite read releases its Durable Object waiter', async () => {
  const abort = new AbortController();
  const read = backend.read(['cancel'], ['$'], {
    block: 0,
    signal: abort.signal,
  });
  const rejection = read.then(
    () => null,
    (error: unknown) => error
  );
  await waitForReaders(1);
  abort.abort();
  expect(await rejection).toBeInstanceOf(Error);
  await waitForReaders(0);
});

test('request-scoped stream APIs preserve cursors across bounded blocking transport reads', async () => {
  const work: Promise<unknown>[] = [];
  await withRequestResources(
    async () => {
      requestResource(STREAMS_RESOURCE, () => backend);
      const first = await streamAdd('scoped', { value: 'before' });
      expect(first).toBeString();
      const read = streamRead(['scoped'], ['$'], { block: 4000 });
      await waitForReaders(1);
      await Bun.sleep(1200);
      const second = await streamAdd('scoped', { value: 'after' });
      expect((await read).map((row) => row.id)).toEqual([second!]);
      expect(
        (await streamRead(['scoped'], [first!])).map((row) => row.payload)
      ).toEqual([{ value: 'after' }]);
      return new Response(null);
    },
    (task) => work.push(task)
  );
  await Promise.all(work);
  await waitForReaders(0);
});

test('SSE enforces signed channels, resumes authorized cursors and cleans up a cancelled response', async () => {
  const { NextRequest } = await import('next/server');
  const { GET } = await import(
    '../../../apps/web/src/app/api/sse/events/route'
  );
  const { signRealtimeToken, toStreamKey } = await import(
    '../../api/src/realtime'
  );
  const previous = process.env.REALTIME_SIGNING_SECRET;
  process.env.REALTIME_SIGNING_SECRET = crypto.randomUUID();
  const tasks: Promise<unknown>[] = [];
  const request = (query: URLSearchParams) =>
    withRequestResources(
      async () => {
        requestResource(STREAMS_RESOURCE, () => backend);
        return GET(
          new NextRequest(`http://localhost/api/sse/events?${query}`, {
            headers: { 'cf-connecting-ip': '192.0.2.41' },
          })
        );
      },
      (task) => tasks.push(task)
    );
  try {
    const token = signRealtimeToken({
      userId: 'alice',
      channels: ['notifications:alice'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect((await request(new URLSearchParams())).status).toBe(401);
    expect(
      (await request(new URLSearchParams({ token: 'invalid' }))).status
    ).toBe(401);
    expect(
      (
        await request(
          new URLSearchParams({ token, channels: 'notifications:bob' })
        )
      ).status
    ).toBe(403);
    expect(
      (await request(new URLSearchParams({ token, cursor: '{bad' }))).status
    ).toBe(400);
    const id = await backend.add(toStreamKey('notifications:alice'), {
      marker: 'authorized',
    });
    await backend.add(toStreamKey('notifications:bob'), {
      marker: 'private-bob',
    });
    const response = await request(
      new URLSearchParams({
        token,
        channels: 'notifications:alice,notifications:bob',
        cursor: JSON.stringify({
          'notifications:alice': '0-0',
          'notifications:bob': '0-0',
        }),
      })
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      const decoder = new TextDecoder();
      const connected = decoder.decode((await reader.read()).value);
      expect(connected).toContain('notifications:alice');
      expect(connected).not.toContain('notifications:bob');
      const event = decoder.decode((await reader.read()).value);
      expect(event).toContain('authorized');
      expect(event).toContain(id);
      expect(event).not.toContain('private-bob');
    } finally {
      await reader.cancel();
    }
    await waitForReaders(0);
  } finally {
    if (previous === undefined) delete process.env.REALTIME_SIGNING_SECRET;
    else process.env.REALTIME_SIGNING_SECRET = previous;
    await Promise.all(tasks);
  }
}, 15000);

test('all nine Cloudflare state backends answer real SQLite health probes', async () => {
  const response = await fetch(`${endpoint}/health-all`);
  expect(response.ok).toBe(true);
  const result = (await response.json()) as {
    healthy: boolean;
    backends: Array<{ name: string; healthy: boolean }>;
  };
  expect(result.healthy).toBe(true);
  expect(result.backends).toHaveLength(9);
  expect(new Set(result.backends.map((backend) => backend.name)).size).toBe(9);
  expect(result.backends.every((backend) => backend.healthy)).toBe(true);
});

test('paused ingress blocks requests while authenticated readiness checks all real state backends', async () => {
  const blocked = await fetch(`${endpoint}/cutover/api/posts`, {
    method: 'POST',
  });
  expect(blocked.status).toBe(503);
  expect(blocked.headers.get('retry-after')).toBe('60');
  expect((await fetch(`${endpoint}/cutover/__shared-state`)).status).toBe(401);
  const ready = await fetch(`${endpoint}/cutover/__shared-state`, {
    headers: { authorization: 'Bearer fixture-secret' },
  });
  expect(ready.status).toBe(200);
  const state = (await ready.json()) as {
    healthy: boolean;
    paused: boolean;
    backends: object[];
  };
  expect(state.healthy).toBe(true);
  expect(state.paused).toBe(true);
  expect(state.backends).toHaveLength(9);
  expect(
    (
      await fetch(`${endpoint}/cutover/api/posts`, {
        method: 'POST',
        headers: { 'x-fixture-paused': 'false' },
      })
    ).status
  ).toBe(200);
});
