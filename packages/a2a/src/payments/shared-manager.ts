/**
 * Shared X402 manager with request-scoped durable storage.
 *
 * Payment requests are created and verified in different requests (and often
 * different isolates/instances), so every caller must use managers backed by
 * the same durable store. Cloudflare mode requires its private storage binding.
 * The legacy Redis path retains its existing behavior while cutover is pending.
 */

import { ensureRedisReady, type RedisInstance } from '@feed/api';
import { getCurrentRpcUrl } from '@feed/shared';
import { getRequestResource } from '@feed/shared/server/request-scope';
import { PAYMENT_STORAGE_RESOURCE } from './cloudflare-backend';
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
 * Create an X402 manager bound to the current shared storage backend. A new
 * manager is created per request so separate isolates observe the same durable
 * payment requests and transaction claims.
 */
export async function getSharedX402Manager(): Promise<X402Manager> {
  const cloudflare = getRequestResource<RedisClient>(PAYMENT_STORAGE_RESOURCE);
  if (cloudflare)
    return new X402Manager({
      rpcUrl: getCurrentRpcUrl(),
      paymentTimeout: PAYMENT_TIMEOUT_MS,
      redis: cloudflare,
    });
  if (process.env.PAYMENT_STORAGE_BACKEND === 'cloudflare')
    throw new Error('Cloudflare payment storage binding unavailable');
  if (
    process.env.PAYMENT_STORAGE_BACKEND &&
    process.env.PAYMENT_STORAGE_BACKEND !== 'redis'
  )
    throw new Error('Unsupported payment storage backend');
  const redis = await ensureRedisReady();
  return new X402Manager({
    rpcUrl: getCurrentRpcUrl(),
    paymentTimeout: PAYMENT_TIMEOUT_MS,
    redis: redis ? ioredisToX402Redis(redis) : undefined,
  });
}
