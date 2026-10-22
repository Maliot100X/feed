import { z } from 'zod';
import type { RedisClient } from './x402-manager';

export const PAYMENT_STORAGE_RESOURCE = 'cloudflare-payment-storage';
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}

/** Implements the manager's storage contract without a Redis connection. */
export function createCloudflarePaymentStorage(
  send: (body: string) => Promise<StateResponse>
): RedisClient {
  async function call(body: object): Promise<unknown> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare payment storage failed (HTTP ${response.status})`
      );
    }
    return response.json();
  }
  return {
    async get(key) {
      return z
        .object({ value: z.string().nullable() })
        .parse(await call({ operation: 'get', key })).value;
    },
    async set(key, value, options) {
      z.object({ stored: z.literal(true) }).parse(
        await call({
          operation: 'set',
          key,
          value,
          ttl: options?.ex,
          absent: false,
        })
      );
    },
    async setIfAbsent(key, value, ttlSeconds) {
      return z.object({ stored: z.boolean() }).parse(
        await call({
          operation: 'set',
          key,
          value,
          ttl: ttlSeconds,
          absent: true,
        })
      ).stored;
    },
    async del(key) {
      z.object({ success: z.literal(true) }).parse(
        await call({ operation: 'del', key })
      );
    },
    async keys(pattern) {
      return z
        .object({ keys: z.array(z.string()) })
        .parse(await call({ operation: 'keys', pattern })).keys;
    },
  };
}
