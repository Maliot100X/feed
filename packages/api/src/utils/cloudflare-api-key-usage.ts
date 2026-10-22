import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';

export const API_KEY_USAGE_RESOURCE = 'cloudflare-api-key-usage';
export const usageEntrySchema = z
  .object({
    keyId: z.string().min(1),
    timestamp: z.number().int().nonnegative().max(8640000000000000),
  })
  .strict();
export type UsageEntry = z.infer<typeof usageEntrySchema>;
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}
export function createCloudflareApiKeyUsage(
  send: (body: string) => Promise<StateResponse>
) {
  async function call(body: object): Promise<unknown> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare API key usage failed (HTTP ${response.status})`
      );
    }
    return response.json();
  }
  return {
    async record(entry: UsageEntry) {
      z.object({ success: z.literal(true) }).parse(
        await call({ operation: 'record', entry })
      );
    },
    async batch(limit: number): Promise<UsageEntry[]> {
      return z
        .array(usageEntrySchema)
        .parse(await call({ operation: 'batch', limit }));
    },
    async acknowledge(entries: UsageEntry[]): Promise<void> {
      z.object({ success: z.literal(true) }).parse(
        await call({ operation: 'acknowledge', entries })
      );
    },
  };
}
export function cloudflareApiKeyUsage() {
  const resource = getRequestResource<
    ReturnType<typeof createCloudflareApiKeyUsage>
  >(API_KEY_USAGE_RESOURCE);
  if (resource) return resource;
  if (process.env.API_KEY_USAGE_BACKEND === 'cloudflare')
    throw new Error('Cloudflare API key usage binding unavailable');
  if (
    process.env.API_KEY_USAGE_BACKEND &&
    process.env.API_KEY_USAGE_BACKEND !== 'redis'
  )
    throw new Error('Unsupported API key usage backend');
  return undefined;
}
