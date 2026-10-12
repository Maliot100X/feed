import {
  and,
  db,
  eq,
  inArray,
  type JsonValue,
  lt,
  or,
  realtimeOutboxes,
  sql,
} from '@feed/db';
import { logger } from '@feed/shared';
import { randomUUID } from 'crypto';
import { streamAdd } from '../redis';
import type { RealtimeEventEnvelope } from './index';
import { toStreamKey } from './index';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 100;

/**
 * Persist an event in the realtime outbox for retry.
 */
export async function enqueueOutbox(
  event: RealtimeEventEnvelope
): Promise<void> {
  // RealtimeEventEnvelope is compatible with JsonValue - it's a plain object with JsonValue fields
  const payload: JsonValue = {
    channel: event.channel,
    type: event.type,
    version: event.version ?? 'v1',
    data: event.data,
    timestamp: event.timestamp,
  };
  await db.insert(realtimeOutboxes).values({
    id: randomUUID(),
    channel: event.channel,
    type: event.type,
    version: event.version ?? 'v1',
    payload,
    updatedAt: new Date(),
  });
}

/** A claimed row is invisible to other drains for this long. */
const CLAIM_LEASE_SECONDS = 60;

function parseEnvelope(payload: JsonValue): RealtimeEventEnvelope | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const { channel, type, version, data, timestamp } = payload;
  if (typeof channel !== 'string' || typeof type !== 'string') return null;
  if (data === undefined) return null;
  const ts = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!Number.isFinite(ts)) return null;
  return {
    channel,
    type,
    version: typeof version === 'string' ? version : undefined,
    data,
    timestamp: ts,
  };
}

async function markRow(
  id: string,
  update: {
    status: 'sent' | 'failed';
    lastError: string | null;
    attempts?: number;
  }
): Promise<void> {
  await db
    .update(realtimeOutboxes)
    .set({
      status: update.status,
      lastError: update.lastError,
      updatedAt: new Date(),
      ...(update.attempts !== undefined && { attempts: update.attempts }),
    })
    .where(eq(realtimeOutboxes.id, id));
}

/**
 * Drain a batch of pending/failed events and publish to Streams.
 *
 * Rows are claimed atomically (FOR UPDATE SKIP LOCKED + attempt increment +
 * lease) so overlapping drains never publish the same row twice; a crashed
 * drain's claims become eligible again after the lease expires. Every row
 * ends the batch as sent or failed with its error recorded; malformed rows
 * are failed permanently.
 */
export async function drainOutboxBatch(limit: number = BATCH_SIZE): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const claimable = db
    .select({ id: realtimeOutboxes.id })
    .from(realtimeOutboxes)
    .where(
      and(
        or(
          eq(realtimeOutboxes.status, 'pending'),
          and(
            eq(realtimeOutboxes.status, 'failed'),
            lt(realtimeOutboxes.attempts, MAX_ATTEMPTS)
          )
        ),
        or(
          eq(realtimeOutboxes.attempts, 0),
          lt(
            realtimeOutboxes.updatedAt,
            sql`now() - make_interval(secs => ${CLAIM_LEASE_SECONDS})`
          )
        )
      )
    )
    .orderBy(realtimeOutboxes.createdAt)
    .limit(limit)
    .for('update', { skipLocked: true });

  const rows = await db
    .update(realtimeOutboxes)
    .set({
      attempts: sql`${realtimeOutboxes.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(realtimeOutboxes.id, claimable))
    .returning();

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const envelope = parseEnvelope(row.payload);
    if (!envelope) {
      logger.error(
        'Invalid payload structure in outbox',
        { rowId: row.id },
        'RealtimeOutbox'
      );
      await markRow(row.id, {
        status: 'failed',
        lastError: 'Invalid payload structure',
        attempts: MAX_ATTEMPTS,
      });
      failed++;
      continue;
    }

    const envelopeRecord: Record<string, JsonValue> = {
      channel: envelope.channel,
      type: envelope.type,
      version: envelope.version ?? 'v1',
      data: envelope.data,
      timestamp: envelope.timestamp,
    };

    let streamId: string | null;
    try {
      streamId = await streamAdd(
        toStreamKey(envelope.channel),
        envelopeRecord,
        {
          maxlen: 10_000,
        }
      );
    } catch (error) {
      await markRow(row.id, {
        status: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      });
      failed++;
      continue;
    }

    if (!streamId) {
      await markRow(row.id, {
        status: 'failed',
        lastError: 'Redis stream unavailable',
      });
      failed++;
      continue;
    }

    await markRow(row.id, { status: 'sent', lastError: null });
    sent++;
  }

  return { processed: rows.length, sent, failed };
}
