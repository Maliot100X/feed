import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createCloudflareOrgCoordination,
  ORG_COORDINATION_RESOURCE,
} from '../../api/src/services/cloudflare-org-coordination';
import {
  OrgCoordinationService,
  type OrgReaction,
} from '../../api/src/services/org-coordination-service';
import {
  requestResource,
  withRequestResources,
} from '../../shared/src/server/request-scope';

const root = resolve(import.meta.dir, '../../..');
const backend = createCloudflareOrgCoordination((body) =>
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
      'packages/testing/fixtures/cloudflare-org-coordination/wrangler.toml',
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
        operation: 'count',
        orgId: 'ready',
        eventId: 'ready',
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
  stateDirectory = await mkdtemp(join(tmpdir(), 'feed-org-coordination-'));
  await start();
}, 60_000);

afterAll(async () => {
  await stop();
  if (stateDirectory)
    await rm(stateDirectory, { recursive: true, force: true });
}, 30_000);

function reaction(index: number, eventId = 'event'): OrgReaction {
  return {
    npcId: `npc-${index}`,
    npcName: `NPC ${index}`,
    eventId,
    angle: `Financial angle ${index}`,
    actionType: 'post',
    sentiment: 'positive',
    timestamp: index,
  };
}

test('concurrent reactions preserve sorted membership, duplicate handling, pair isolation, and restart persistence', async () => {
  const before = Date.now();
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      backend.record('org', reaction(19 - index))
    )
  );
  await backend.record('org', reaction(0));
  await backend.record('other-org', reaction(0));
  await backend.record('org', reaction(0, 'other-event'));
  const expected = Array.from({ length: 20 }, (_, index) => reaction(index));
  expect(await backend.read('org', 'event')).toEqual(expected);
  expect(await backend.count('org', 'event')).toBe(20);
  expect(await backend.count('other-org', 'event')).toBe(1);
  expect(await backend.count('org', 'other-event')).toBe(1);
  await stop();
  let expiryChecked = false;
  for await (const file of new Bun.Glob('**/*.sqlite').scan({
    cwd: stateDirectory,
    absolute: true,
  })) {
    const db = new Database(file);
    try {
      if (
        !db
          .query("SELECT name FROM sqlite_master WHERE name='org_events'")
          .get()
      )
        continue;
      const row = db
        .query<{ expires_at: number }, []>(
          "SELECT expires_at FROM org_events WHERE org_id='org' AND event_id='event'"
        )
        .get();
      expect(row?.expires_at).toBeGreaterThanOrEqual(
        before + 12 * 60 * 60 * 1000
      );
      expect(row?.expires_at).toBeLessThanOrEqual(
        Date.now() + 12 * 60 * 60 * 1000
      );
      expiryChecked = true;
    } finally {
      db.close();
    }
  }
  expect(expiryChecked).toBe(true);
  await start();
  expect(await backend.read('org', 'event')).toEqual(expected);
}, 60_000);

test('service context and thresholds use the shared backend without truncating reactions', async () => {
  const tasks: Promise<unknown>[] = [];
  await withRequestResources(
    async () => {
      requestResource(ORG_COORDINATION_RESOURCE, () => backend);
      const service = new OrgCoordinationService();
      expect(await service.recordOrgReaction('service-org', reaction(1))).toBe(
        true
      );
      const contexts = await service.getCoordinationContext(
        ['org', 'service-org'],
        'event',
        new Map([['org', 'Named Org']])
      );
      expect(contexts[0]?.orgName).toBe('Named Org');
      expect(contexts[0]?.recentReactions).toHaveLength(20);
      expect(contexts[0]?.avoidAngles).toHaveLength(20);
      expect(contexts[0]?.suggestedAngles).toContain(
        'Consider not reacting - org has said enough'
      );
      expect(await service.hasOrgReactedEnough('org', 'event', 20)).toBe(true);
      expect(await service.hasOrgReactedEnough('org', 'event', 21)).toBe(false);
      expect(await service.getReactionCount('service-org', 'event')).toBe(1);
      return new Response(null);
    },
    (task) => tasks.push(task)
  );
  await Promise.all(tasks);
});

test('expired pairs lose all reactions without changing other organizations', async () => {
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
          .query("SELECT name FROM sqlite_master WHERE name='org_events'")
          .get()
      )
        continue;
      updated =
        db
          .query(
            "UPDATE org_events SET expires_at=? WHERE org_id='org' AND event_id='event'"
          )
          .run(Date.now() - 1).changes === 1;
    } finally {
      db.close();
    }
  }
  expect(updated).toBe(true);
  await start();
  expect(await backend.read('org', 'event')).toEqual([]);
  expect(await backend.count('org', 'event')).toBe(0);
  expect(await backend.count('other-org', 'event')).toBe(1);
  expect(await backend.count('org', 'other-event')).toBe(1);
  await backend.record('org', reaction(99));
  expect(await backend.read('org', 'event')).toEqual([reaction(99)]);
}, 60_000);

test('invalid reaction data and missing bindings fail explicitly', async () => {
  expect(
    (
      await call({
        operation: 'record',
        orgId: 'org',
        eventId: 'wrong',
        reaction: JSON.stringify(reaction(1)),
      })
    ).status
  ).toBe(400);
  expect(
    (
      await call({
        operation: 'record',
        orgId: 'org',
        eventId: 'event',
        reaction: 'invalid-json',
      })
    ).status
  ).toBe(400);
  const previous = process.env.ORG_COORDINATION_BACKEND;
  process.env.ORG_COORDINATION_BACKEND = 'cloudflare';
  try {
    await expect(
      new OrgCoordinationService().getReactionCount('org', 'event')
    ).rejects.toThrow('binding unavailable');
  } finally {
    if (previous === undefined) delete process.env.ORG_COORDINATION_BACKEND;
    else process.env.ORG_COORDINATION_BACKEND = previous;
  }
});
