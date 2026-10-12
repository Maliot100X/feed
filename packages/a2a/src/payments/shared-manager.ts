/**
 * Shared, Redis-backed X402 manager.
 *
 * Payment requests are created and verified in different requests (and often
 * different isolates/instances), so every caller must use managers backed by
 * the same durable store. Without Redis the manager falls back to
 * process-local state, which only works within a single process.
 */

import { ensureRedisReady, type RedisInstance } from '@feed/api';
import { getCurrentRpcUrl } from '@feed/shared';
import { type RedisClient, X402Manager } from './x402-manager';

/** Payment requests stay valid for 15 minutes. */
const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

export function ioredisToX402Redis(redis: RedisInstance): RedisClient {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, options) => {
      if (options?.ex !== undefined) {
        await redis.set(key, value, 'EX', options.ex);
      } else {
        await redis.set(key, value);
      }
    },
    setIfAbsent: async (key, value, ttlSeconds) =>
      (await redis.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK',
    del: async (key) => {
      await redis.del(key);
    },
    keys: (pattern) => redis.keys(pattern),
  };
}

/**
 * Create an X402 manager bound to the current Redis client. A new manager is
 * created per call because Redis clients can be request-scoped (Workers); all
 * payment state lives in Redis, so managers created in different requests
 * observe the same requests and transaction claims.
 */
export async function getSharedX402Manager(): Promise<X402Manager> {
  const redis = await ensureRedisReady();
  return new X402Manager({
    rpcUrl: getCurrentRpcUrl(),
    paymentTimeout: PAYMENT_TIMEOUT_MS,
    redis: redis ? ioredisToX402Redis(redis) : undefined,
  });
}
