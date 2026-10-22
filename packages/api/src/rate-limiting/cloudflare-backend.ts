import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';

export const RATE_LIMIT_RESOURCE = 'cloudflare-rate-limit-backend';
const checkResult = z.object({
  allowed: z.boolean(),
  remaining: z.number().int().nonnegative(),
  retryAfter: z.number().int().nonnegative().optional(),
});
const statusResult = z.object({
  count: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resetAtMs: z.number().int().safe(),
});
type Config = { actionType: string; windowMs: number; maxRequests: number };

interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}

/** Private Worker binding transport; no Redis or process-memory fallback. */
export function createCloudflareRateLimitBackend(
  send: (body: string) => Promise<StateResponse>
) {
  async function call(body: object): Promise<unknown> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare rate limit operation failed (HTTP ${response.status})`
      );
    }
    return response.json();
  }
  return {
    async check(userId: string, config: Config) {
      return checkResult.parse(
        await call({ operation: 'check', userId, ...config })
      );
    },
    async status(userId: string, config: Config) {
      const result = statusResult.parse(
        await call({ operation: 'status', userId, ...config })
      );
      return {
        count: result.count,
        remaining: result.remaining,
        resetAt: new Date(result.resetAtMs),
      };
    },
    async reset(userId: string, actionType: string) {
      z.object({ reset: z.literal(true) }).parse(
        await call({ operation: 'reset', userId, actionType })
      );
    },
    async clear() {
      z.object({ cleared: z.literal(true) }).parse(
        await call({ operation: 'clear' })
      );
    },
  };
}
export function cloudflareRateLimitBackend() {
  return getRequestResource<
    ReturnType<typeof createCloudflareRateLimitBackend>
  >(RATE_LIMIT_RESOURCE);
}
