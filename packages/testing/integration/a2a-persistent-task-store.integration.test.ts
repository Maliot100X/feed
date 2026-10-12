/**
 * PersistentTaskStore against a real Redis: cross-instance reads and lists,
 * status index maintenance and legacy double-encoded entries.
 *
 * Requires TEST_REDIS_URL (disposable Redis). Skipped otherwise.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import path from 'node:path';
import type { Task } from '@a2a-js/sdk';
import IORedis from 'ioredis';

const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!redisUrl)('PersistentTaskStore (Redis)', () => {
  const redis = redisUrl ? new IORedis(redisUrl) : null;
  const contextId = `ctx-${crypto.randomUUID()}`;
  let PersistentTaskStore: typeof import('../../a2a/src/persistent-task-store').PersistentTaskStore;

  const makeTask = (
    id: string,
    state: Task['status']['state'],
    at: number
  ): Task => ({
    kind: 'task',
    id,
    contextId,
    status: { state, timestamp: new Date(at).toISOString() },
    history: [],
  });

  beforeAll(async () => {
    const apiIndex = path.resolve(import.meta.dir, '../../api/src/index.ts');
    const actualApi = await import(apiIndex);
    const overrides = {
      getRedisClient: () => redis,
      isRedisAvailable: () => true,
    };
    mock.module('@feed/api', () => ({ ...actualApi, ...overrides }));
    ({ PersistentTaskStore } = await import(
      '../../a2a/src/persistent-task-store'
    ));
  });

  afterAll(async () => {
    const keys = await redis!.keys('a2a:*');
    if (keys.length > 0) await redis!.del(...keys);
    redis!.disconnect();
    mock.restore();
  });

  it('a cold instance can load and list tasks saved by another instance', async () => {
    const writer = new PersistentTaskStore();
    await writer.save(makeTask('t-1', 'working', 1_700_000_000_000));
    await writer.save(makeTask('t-2', 'completed', 1_700_000_001_000));

    const reader = new PersistentTaskStore();
    expect((await reader.load('t-1'))?.status.state).toBe('working');

    const listed = await new PersistentTaskStore().list({ contextId });
    expect(listed.tasks.map((t) => t.id)).toEqual(['t-2', 't-1']);
    expect(listed.totalSize).toBe(2);
  });

  it('reads the latest state written by another instance', async () => {
    const a = new PersistentTaskStore();
    const b = new PersistentTaskStore();
    await a.save(makeTask('t-3', 'working', 1_700_000_002_000));
    expect((await b.load('t-3'))?.status.state).toBe('working');

    await a.updateStatus('t-3', { state: 'canceled' });
    expect((await b.load('t-3'))?.status.state).toBe('canceled');
  });

  it('removes a task from its previous status index on status change', async () => {
    const store = new PersistentTaskStore();
    await store.save(makeTask('t-4', 'working', 1_700_000_003_000));
    await store.updateStatus('t-4', { state: 'completed' });

    const working = await new PersistentTaskStore().list({
      contextId,
      status: 'working',
    });
    expect(working.tasks.map((t) => t.id)).not.toContain('t-4');
    const completed = await new PersistentTaskStore().list({
      contextId,
      status: 'completed',
    });
    expect(completed.tasks.map((t) => t.id)).toContain('t-4');
  });

  it('reads legacy double-encoded entries in single and batch paths', async () => {
    const legacyAt = Date.now() + 10_000;
    const legacy = makeTask('t-legacy', 'completed', legacyAt);
    await redis!.set(
      'a2a:tasks:task:t-legacy',
      JSON.stringify(JSON.stringify(legacy))
    );
    await redis!.zadd(
      `a2a:task-index:context:${contextId}`,
      legacyAt,
      't-legacy'
    );

    expect((await new PersistentTaskStore().load('t-legacy'))?.id).toBe(
      't-legacy'
    );
    const listed = await new PersistentTaskStore().list({
      contextId,
      pageSize: 1,
    });
    expect(listed.tasks[0]?.id).toBe('t-legacy');
  });

  it('applies historyLength 0 on the Redis list path', async () => {
    const task = makeTask('t-hist', 'completed', Date.now() + 20_000);
    task.history = [
      {
        kind: 'message',
        messageId: 'm',
        role: 'user',
        parts: [{ kind: 'text', text: 'x' }],
      },
    ];
    await new PersistentTaskStore().save(task);
    const listed = await new PersistentTaskStore().list({
      contextId,
      historyLength: 0,
      pageSize: 1,
    });
    expect(listed.tasks[0]?.id).toBe('t-hist');
    expect(listed.tasks[0]?.history).toEqual([]);
  });
});
