/**
 * API Key lastUsedAt Write-Back Cache Flusher
 *
 * Batches Redis-buffered lastUsedAt updates and writes them to the database
 * periodically: one transaction per flush containing one UPDATE per key.
 *
 * Flush strategy:
 * - Periodic: flush up to FLUSH_BATCH_SIZE oldest entries every 30 seconds
 * - Startup / shutdown: flush pending entries
 *
 * Correctness:
 * - DB writes are monotonic (GREATEST), so replaying a stale entry never
 *   moves lastUsedAt backwards.
 * - After the DB commit, an entry is only removed from Redis if its hash value
 *   still equals the timestamp that was flushed (atomic Lua compare-and-delete),
 *   so a newer timestamp written by a request during the flush is kept for the
 *   next flush instead of being lost.
 *
 * Multi-instance: flush is guarded by a Redis `SET NX` lock so only one worker drains
 * the shared queue/hash at a time (TTL recovers if a process dies while holding the lock).
 */

import { randomBytes } from 'node:crypto';

import { asSystem, eq, sql, userApiKeys } from '@feed/db';
import { logger } from '@feed/shared';
import { getRedisClient, isRedisAvailable } from '../redis';

/**
 * Redis keys for write-back cache.
 *
 * WHY separate structures:
 * - Hash: O(1) lookup for latest timestamp per key (handles multiple updates before flush)
 * - Sorted Set: Natural ordering for batching oldest updates first
 */
const REDIS_KEY_LAST_USED_UPDATES = 'api-key:last-used:updates'; // Hash: keyId → timestamp
const REDIS_KEY_LAST_USED_QUEUE = 'api-key:last-used:queue'; // Sorted Set: score=timestamp, member=keyId
/** Cross-process flush mutex (SET NX); TTL bounds stuck-lock if a worker dies mid-flush */
const REDIS_KEY_FLUSH_LOCK = 'api-key:last-used:flush-lock';
const FLUSH_LOCK_TTL_SEC = 120;

/** Safe release: only delete lock if value matches our token (ioredis: eval script, numKeys, key, arg) */
const RELEASE_FLUSH_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * Acknowledge flushed entries: for each key, delete it from the hash and queue
 * only if the hash still holds the exact timestamp that was flushed.
 * KEYS[1] = hash, KEYS[2] = queue; ARGV = keyId1, ts1, keyId2, ts2, ...
 * Returns the number of acknowledged entries.
 */
const ACK_FLUSHED_LUA = `
local acked = 0
for i = 1, #ARGV, 2 do
  local keyId = ARGV[i]
  local ts = ARGV[i + 1]
  if redis.call("hget", KEYS[1], keyId) == ts then
    redis.call("hdel", KEYS[1], keyId)
    redis.call("zrem", KEYS[2], keyId)
    acked = acked + 1
  end
end
return acked
`;

/**
 * SQL expression that only moves lastUsedAt forward.
 * GREATEST ignores NULL, so a never-used key takes the new timestamp.
 */
export function monotonicLastUsedAt(timestamp: Date) {
  return sql`GREATEST(${userApiKeys.lastUsedAt}, ${timestamp.toISOString()}::timestamp)`;
}

// Flush configuration
/**
 * Flush interval in milliseconds.
 *
 * WHY 30 seconds: Balances update freshness (acceptable delay for lastUsedAt) with database load.
 * Lower = more frequent flushes (higher DB load), Higher = longer delay (lower DB load).
 */
const FLUSH_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Maximum number of updates to flush in a single batch.
 *
 * WHY 100: Balances transaction size with flush frequency. Higher = fewer transactions but larger,
 * Lower = more transactions but smaller. 100 is a good balance for most workloads.
 */
const FLUSH_BATCH_SIZE = 100; // Flush up to 100 updates at once

/**
 * Flush interval timer.
 *
 * WHY null initially: Set when flusher starts, cleared when stopped. Null check prevents
 * multiple flushers from starting.
 */
let flushInterval: NodeJS.Timeout | null = null;

// Metrics tracking
/**
 * WHY track metrics: Enables monitoring of flush health, success rate, and total throughput.
 * Useful for detecting issues and tuning flush parameters.
 */
let flushSuccessCount = 0;
let flushFailureCount = 0;
let totalUpdatesFlushed = 0;
const globalFlusherState = globalThis as typeof globalThis & {
  __feedApiKeyFlusherSignalsRegistered?: boolean;
};

/**
 * Flush pending lastUsedAt updates from Redis to database.
 *
 * Process:
 * 1. Get oldest N entries from sorted set (ordered by timestamp)
 * 2. Read corresponding timestamps from hash
 * 3. Apply monotonic UPDATEs to the database in one transaction
 * 4. Atomically remove entries whose timestamp was not superseded meanwhile
 *
 * @param maxEntries - Maximum number of entries to flush (default: FLUSH_BATCH_SIZE)
 * @returns Number of entries flushed
 */
async function flushPendingUpdates(
  maxEntries: number = FLUSH_BATCH_SIZE
): Promise<number> {
  const redisClient = getRedisClient();
  if (!redisClient || !isRedisAvailable()) {
    logger.debug(
      'Redis not available, skipping flush',
      undefined,
      'ApiKeyFlusher'
    );
    return 0;
  }

  const lockToken = randomBytes(16).toString('hex');
  let lockAcquired: string | null = null;
  try {
    lockAcquired = await redisClient.set(
      REDIS_KEY_FLUSH_LOCK,
      lockToken,
      'EX',
      FLUSH_LOCK_TTL_SEC,
      'NX'
    );
  } catch (error) {
    logger.debug(
      'Redis unavailable while acquiring API key flush lock, skipping',
      {
        error: error instanceof Error ? error.message : String(error),
      },
      'ApiKeyFlusher'
    );
    return 0;
  }

  if (lockAcquired !== 'OK') {
    logger.debug(
      'Flush lock held (another instance or overlapping flush), skipping',
      undefined,
      'ApiKeyFlusher'
    );
    return 0;
  }

  try {
    // Get oldest N entries from sorted set (ordered by timestamp)
    // WHY: Process oldest updates first to minimize delay.
    const queueEntries = await redisClient.zrange(
      REDIS_KEY_LAST_USED_QUEUE,
      0,
      maxEntries - 1,
      'WITHSCORES'
    );

    if (queueEntries.length === 0) {
      return 0;
    }

    // Parse entries: [keyId1, timestamp1, keyId2, timestamp2, ...]
    // WHY: ZRANGE WITHSCORES returns alternating [member, score, member, score, ...]
    const keyIds: string[] = [];
    for (let i = 0; i < queueEntries.length; i += 2) {
      keyIds.push(queueEntries[i] as string);
    }

    // Read corresponding timestamps from hash
    // WHY: Hash has the latest timestamp for each key. If a key was updated multiple times
    // before flush, we only need the latest timestamp (not the queue score which is first update time).
    const timestamps = await redisClient.hmget(
      REDIS_KEY_LAST_USED_UPDATES,
      ...keyIds
    );

    // Build array of updates with valid timestamps
    // WHY filter nulls: If hash entry is missing (shouldn't happen, but handle gracefully),
    // skip that key. Queue entry will be cleaned up below.
    const updates: Array<{ keyId: string; timestamp: string }> = [];
    for (let i = 0; i < keyIds.length; i++) {
      const timestamp = timestamps[i];
      if (timestamp) {
        updates.push({ keyId: keyIds[i]!, timestamp });
      }
    }

    if (updates.length === 0) {
      // Clean up queue entries even if hash is empty (stale entries)
      // WHY: Prevents queue from growing with stale entries. If hash is empty but queue has
      // entries, they're orphaned and should be removed.
      await redisClient.zrem(REDIS_KEY_LAST_USED_QUEUE, ...keyIds);
      return 0;
    }

    // Execute individual UPDATE statements within a single transaction.
    // WHY: Transaction groups N updates into one commit, reducing connection overhead vs N separate
    // auto-committed queries. Not a single SQL statement, but still provides significant DB load reduction.
    await asSystem(async (dbClient) => {
      await dbClient.transaction(async (tx) => {
        // Execute all updates within single transaction
        // WHY: Transaction ensures atomicity and reduces per-query commit overhead.
        for (const update of updates) {
          await tx
            .update(userApiKeys)
            .set({
              lastUsedAt: monotonicLastUsedAt(new Date(update.timestamp)),
            })
            .where(eq(userApiKeys.id, update.keyId));
        }
      });
    });

    // Acknowledge flushed entries. Only entries whose hash value still equals
    // the flushed timestamp are removed; newer timestamps written during the
    // DB transaction stay queued. If this fails, entries are re-flushed later,
    // which is harmless because DB writes are monotonic.
    try {
      const ackArgs: string[] = [];
      for (const update of updates) {
        ackArgs.push(update.keyId, update.timestamp);
      }
      await redisClient.eval(
        ACK_FLUSHED_LUA,
        2,
        REDIS_KEY_LAST_USED_UPDATES,
        REDIS_KEY_LAST_USED_QUEUE,
        ...ackArgs
      );
    } catch (redisError) {
      logger.warn(
        'Failed to acknowledge flushed lastUsedAt entries — they will be re-flushed',
        {
          error:
            redisError instanceof Error
              ? redisError.message
              : String(redisError),
          keyCount: updates.length,
        },
        'ApiKeyFlusher'
      );
    }

    totalUpdatesFlushed += updates.length;
    flushSuccessCount++;

    logger.info(
      `Flushed ${updates.length} lastUsedAt updates to database`,
      { count: updates.length },
      'ApiKeyFlusher'
    );

    return updates.length;
  } catch (error) {
    flushFailureCount++;
    logger.error(
      'Failed to flush lastUsedAt updates',
      { error },
      'ApiKeyFlusher'
    );
    return 0;
  } finally {
    try {
      await redisClient.eval(
        RELEASE_FLUSH_LOCK_LUA,
        1,
        REDIS_KEY_FLUSH_LOCK,
        lockToken
      );
    } catch (releaseErr) {
      logger.warn(
        'Failed to release API key flush lock (will expire by TTL)',
        {
          error:
            releaseErr instanceof Error
              ? releaseErr.message
              : String(releaseErr),
        },
        'ApiKeyFlusher'
      );
    }
  }
}

/**
 * Start the periodic flush service.
 */
export function startLastUsedFlusher(): void {
  if (flushInterval) {
    logger.warn('Flusher already started', undefined, 'ApiKeyFlusher');
    return;
  }

  logger.info(
    'Starting API key lastUsedAt flusher',
    undefined,
    'ApiKeyFlusher'
  );

  // Flush on startup
  // WHY: Handle any pending updates from previous server instance. If server restarted while
  // updates were in Redis, they would be lost without this. Fire-and-forget because startup
  // shouldn't block on flush (non-critical).
  flushPendingUpdates().catch((err) => {
    logger.error('Startup flush failed', { error: err }, 'ApiKeyFlusher');
  });

  // Periodic flush
  // WHY setInterval: Automatically flushes on schedule. Works in long-running processes (Next.js),
  // but may not work reliably in pure serverless (each invocation is new process). For pure
  // serverless, consider using cron endpoint instead.
  flushInterval = setInterval(() => {
    // flushPendingUpdates handles Redis unavailability and its own errors.
    void flushPendingUpdates();
  }, FLUSH_INTERVAL_MS);
  flushInterval.unref?.();

  logger.info(
    `Flusher started: ${FLUSH_INTERVAL_MS}ms interval, ${FLUSH_BATCH_SIZE} batch size`,
    undefined,
    'ApiKeyFlusher'
  );
}

/**
 * Stop the periodic flush service.
 */
export function stopLastUsedFlusher(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
    logger.info(
      'Stopped API key lastUsedAt flusher',
      undefined,
      'ApiKeyFlusher'
    );
  }
}

/**
 * Graceful shutdown: flush pending updates before exit.
 *
 * WHY: Ensures no updates are lost on server restart or shutdown.
 */
export async function shutdownLastUsedFlusher(): Promise<void> {
  stopLastUsedFlusher();

  // Flush any remaining updates
  const remaining = await flushPendingUpdates(1000); // Flush all remaining
  if (remaining > 0) {
    logger.info(
      `Flushed ${remaining} remaining updates on shutdown`,
      { count: remaining },
      'ApiKeyFlusher'
    );
  }
}

/**
 * Manually trigger a flush (useful for testing or graceful shutdown).
 */
export async function flushLastUsedUpdates(): Promise<number> {
  return flushPendingUpdates();
}

/**
 * Get flusher statistics for monitoring.
 */
export function getFlusherStats(): {
  successCount: number;
  failureCount: number;
  totalUpdatesFlushed: number;
} {
  return {
    successCount: flushSuccessCount,
    failureCount: flushFailureCount,
    totalUpdatesFlushed,
  };
}

// Register shutdown handlers
// WHY: Ensures no updates are lost on server restart or shutdown. Flushes any remaining
// updates in Redis before process exits. Only register if process exists (not in edge runtime).
// We avoid calling process.exit() here so framework-managed runtimes can shut down naturally.
if (
  typeof process !== 'undefined' &&
  !globalFlusherState.__feedApiKeyFlusherSignalsRegistered
) {
  globalFlusherState.__feedApiKeyFlusherSignalsRegistered = true;
  let shuttingDown = false;
  const handleShutdown = (signal: string) => {
    if (shuttingDown) return; // Prevent double-signal race
    shuttingDown = true;
    shutdownLastUsedFlusher().catch((err) => {
      logger.error(
        `Shutdown flush failed on ${signal}`,
        { error: err },
        'ApiKeyFlusher'
      );
    });
  };
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}
