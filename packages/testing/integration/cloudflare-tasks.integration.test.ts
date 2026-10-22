import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Task } from '@a2a-js/sdk';
import {
  createCloudflareTaskStore,
  TASK_STORAGE_RESOURCE,
} from '../../a2a/src/cloudflare-task-backend';
import { PersistentTaskStore } from '../../a2a/src/persistent-task-store';
import {
  authorizeTaskReference,
  scopeRequestToCaller,
} from '../../a2a/src/utils/request-scope';
import {
  requestResource,
  withRequestResources,
} from '../../shared/src/server/request-scope';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflareTaskStore((body) =>
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
      'packages/testing/fixtures/cloudflare-tasks/wrangler.toml',
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
      body: JSON.stringify({ operation: 'load', taskId: 'ready' }),
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-tasks-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

function task(id: string, contextId = 'alice', timestamp = 1000): Task {
  return {
    id,
    contextId,
    kind: 'task',
    status: { state: 'working', timestamp: new Date(timestamp).toISOString() },
    history: [
      {
        kind: 'message',
        messageId: id,
        role: 'user',
        parts: [{ kind: 'text', text: 'Complete history' }],
      },
    ],
    artifacts: [
      { artifactId: id, parts: [{ kind: 'text', text: 'Complete artifact' }] },
    ],
    metadata: { retained: true },
  };
}
async function inScope(run: (store: PersistentTaskStore) => Promise<void>) {
  const tasks: Promise<unknown>[] = [];
  await withRequestResources(
    async () => {
      requestResource(TASK_STORAGE_RESOURCE, () => backend);
      await run(new PersistentTaskStore());
      return new Response(null);
    },
    (task) => tasks.push(task)
  );
  await Promise.all(tasks);
}

test('large Unicode tasks persist across restart with complete history/artifacts and cold-instance access', async () => {
  const value = task('large');
  value.metadata = { blob: '🙂'.repeat(700_000) };
  await inScope(async (store) => {
    await store.save(value);
  });
  await stop();
  await start();
  await inScope(async (store) => {
    expect(await store.load('large')).toEqual(value);
  });
}, 60_000);

test('indexes, pagination, projection, status changes and retention preserve underlying tasks', async () => {
  await backend.clear();
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      backend.save(task(`task-${i}`, 'alice', 1000 + i), 604800, 3)
    )
  );
  const listed = await backend.list({
    contextId: 'alice',
    pageSize: 2,
    historyLength: 0,
    includeArtifacts: false,
  });
  expect(listed.totalSize).toBe(3);
  expect(listed.tasks.map((t) => t.id)).toEqual(['task-5', 'task-4']);
  expect(listed.nextPageToken).toBe('2');
  expect(listed.tasks[0]?.history).toEqual([]);
  expect(listed.tasks[0]?.artifacts).toBeUndefined();
  expect((await backend.load('task-0'))?.history).toHaveLength(1);
  expect((await backend.load('task-5'))?.artifacts).toHaveLength(1);
  expect(
    (await backend.list({ contextId: 'alice', pageToken: '2' })).tasks.map(
      (t) => t.id
    )
  ).toEqual(['task-3']);
  await inScope(async (store) => {
    await store.updateStatus('task-5', {
      state: 'completed',
      timestamp: new Date(2000).toISOString(),
    });
  });
  expect(
    (await backend.list({ contextId: 'alice', status: 'working' })).tasks.map(
      (t) => t.id
    )
  ).not.toContain('task-5');
  expect(
    (
      await backend.list({
        contextId: 'alice',
        status: 'completed',
        lastUpdatedAfter: 1500,
      })
    ).tasks.map((t) => t.id)
  ).toEqual(['task-5']);
  expect((await backend.all()).length).toBe(6);
});

test('context moves remove prior-owner index entries and route authorization rejects another user', async () => {
  await backend.save(task('moved', 'alice'), 604800, 1000);
  await backend.save(task('moved', 'bob'), 604800, 1000);
  expect(
    (await backend.list({ contextId: 'alice' })).tasks.map((t) => t.id)
  ).not.toContain('moved');
  await inScope(async (store) => {
    const auth = {
      authMethod: 'user-key' as const,
      userId: 'alice',
      authenticated: true,
    };
    expect(
      await authorizeTaskReference(
        { method: 'tasks/get', params: { id: 'moved' } },
        auth,
        store
      )
    ).toEqual({ ok: false, taskId: 'moved' });
    const body = { method: 'tasks/list', params: { contextId: 'bob' } };
    expect(scopeRequestToCaller(body, auth).ok).toBe(true);
    expect(body.params.contextId).toBe('alice');
  });
});

test('expired tasks cannot resurrect from the local store, invalid requests fail, and clear is durable', async () => {
  await stop();
  let updated = false;
  for await (const file of new Bun.Glob('**/*.sqlite').scan({
    cwd: stateDirectory,
    absolute: true,
  })) {
    const db = new Database(file);
    try {
      if (!db.query("SELECT name FROM sqlite_master WHERE name='tasks'").get())
        continue;
      updated =
        db
          .query("UPDATE tasks SET expires_at=? WHERE id='moved'")
          .run(Date.now() - 1).changes === 1;
    } finally {
      db.close();
    }
  }
  expect(updated).toBe(true);
  await start();
  await inScope(async (store) => {
    expect(await store.load('moved')).toBeUndefined();
  });
  await expect(backend.list({ pageToken: 'invalid' })).rejects.toThrow(
    'HTTP 400'
  );
  expect(
    (await call({ operation: 'save', raw: '{}', ttl: 604800, maxIndex: 1000 }))
      .status
  ).toBe(400);
  await inScope(async (store) => {
    await store.clear();
    expect(await store.getAllTasks()).toEqual([]);
  });
  await stop();
  await start();
  expect(await backend.all()).toEqual([]);
}, 60000);
