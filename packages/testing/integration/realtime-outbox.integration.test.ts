/**
 * Realtime outbox drain: overlapping drains claim each row once, failures are
 * recorded, malformed rows fail permanently.
 *
 * Runs without Redis (publishing fails with "Redis stream unavailable").
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { drainOutboxBatch } from '@feed/api';
import { db, inArray, realtimeOutboxes } from '@feed/db';

const ids: string[] = [];

describe('realtime outbox drain', () => {
  beforeAll(async () => {
    // Clear leftovers so this test owns the drainable set.
    await db.delete(realtimeOutboxes);
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `outbox-${crypto.randomUUID()}`,
      channel: 'feed',
      type: 'test',
      payload: { channel: 'feed', type: 'test', data: { i }, timestamp: i },
      updatedAt: new Date(),
    }));
    const malformed = {
      id: `outbox-bad-${crypto.randomUUID()}`,
      channel: 'feed',
      type: 'test',
      payload: { nope: true },
      updatedAt: new Date(),
    };
    await db.insert(realtimeOutboxes).values([...rows, malformed]);
    ids.push(...rows.map((r) => r.id), malformed.id);
  });

  afterAll(async () => {
    await db.delete(realtimeOutboxes).where(inArray(realtimeOutboxes.id, ids));
  });

  it('claims every row exactly once across overlapping drains', async () => {
    const [a, b] = await Promise.all([drainOutboxBatch(), drainOutboxBatch()]);
    expect(a.processed + b.processed).toBe(ids.length);

    const rows = await db
      .select({
        id: realtimeOutboxes.id,
        status: realtimeOutboxes.status,
        attempts: realtimeOutboxes.attempts,
        lastError: realtimeOutboxes.lastError,
      })
      .from(realtimeOutboxes)
      .where(inArray(realtimeOutboxes.id, ids));

    for (const row of rows) {
      expect(row.status).toBe('failed');
      if (row.id.startsWith('outbox-bad-')) {
        expect(row.attempts).toBe(5);
        expect(row.lastError).toBe('Invalid payload structure');
      } else {
        expect(row.attempts).toBe(1);
        expect(row.lastError).toBe('Redis stream unavailable');
      }
    }

    // Rows within their claim lease are not re-drained immediately.
    expect((await drainOutboxBatch()).processed).toBe(0);
  });
});
