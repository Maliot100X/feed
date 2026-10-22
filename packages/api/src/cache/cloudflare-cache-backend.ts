import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';
export const CACHE_RESOURCE = 'cloudflare-cache';
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}
export function createCloudflareCache(
  send: (body: string) => Promise<StateResponse>
) {
  async function call(body: object): Promise<unknown> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Cloudflare cache failed (HTTP ${response.status})`);
    }
    return response.json();
  }
  async function success(body: object): Promise<void> {
    z.object({ success: z.literal(true) }).parse(await call(body));
  }
  return {
    async get(key: string): Promise<string | null> {
      return z
        .string()
        .nullable()
        .parse(await call({ operation: 'get', key }));
    },
    async ttl(key: string): Promise<number> {
      return z
        .number()
        .int()
        .parse(await call({ operation: 'ttl', key }));
    },
    async mget(...keys: string[]): Promise<Array<string | null>> {
      return z
        .array(z.string().nullable())
        .parse(await call({ operation: 'mget', keys }));
    },
    setMany(entries: Array<[string, string]>, ttl: number) {
      return success({ operation: 'set', entries, ttl });
    },
    del(...keys: string[]) {
      return success({ operation: 'delete', keys });
    },
    invalidate(pattern: string) {
      return success({ operation: 'invalidate', pattern });
    },
    clear() {
      return success({ operation: 'clear' });
    },
  };
}
export function cloudflareCache() {
  const resource =
    getRequestResource<ReturnType<typeof createCloudflareCache>>(
      CACHE_RESOURCE
    );
  if (resource) return resource;
  if (process.env.CACHE_BACKEND === 'cloudflare')
    throw new Error('Cloudflare cache binding unavailable');
  if (process.env.CACHE_BACKEND && process.env.CACHE_BACKEND !== 'redis')
    throw new Error('Unsupported cache backend');
  return undefined;
}
