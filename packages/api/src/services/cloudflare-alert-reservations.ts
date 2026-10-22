import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';

export const ALERT_RESERVATIONS_RESOURCE = 'cloudflare-alert-reservations';
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}
export function createCloudflareAlertReservations(
  send: (body: string) => Promise<StateResponse>
) {
  async function call(body: object): Promise<unknown> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare alert reservation failed (HTTP ${response.status})`
      );
    }
    return response.json();
  }
  return {
    async reserve(
      fingerprint: string,
      ttlSeconds: number
    ): Promise<string | null> {
      const token = crypto.randomUUID();
      const result = z
        .object({ reserved: z.boolean() })
        .parse(
          await call({ operation: 'reserve', fingerprint, token, ttlSeconds })
        );
      return result.reserved ? token : null;
    },
    async release(fingerprint: string, token: string): Promise<void> {
      z.object({ success: z.literal(true) }).parse(
        await call({ operation: 'release', fingerprint, token })
      );
    },
  };
}
export function cloudflareAlertReservations() {
  const resource = getRequestResource<
    ReturnType<typeof createCloudflareAlertReservations>
  >(ALERT_RESERVATIONS_RESOURCE);
  if (resource) return resource;
  if (process.env.ALERT_RESERVATIONS_BACKEND === 'cloudflare')
    throw new Error('Cloudflare alert reservations binding unavailable');
  if (
    process.env.ALERT_RESERVATIONS_BACKEND &&
    process.env.ALERT_RESERVATIONS_BACKEND !== 'redis'
  )
    throw new Error('Unsupported alert reservations backend');
  return undefined;
}
