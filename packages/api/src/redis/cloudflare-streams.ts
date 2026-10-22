import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';
import type { JsonValue } from '../types';
import type { StreamMessage } from './streams';
export const STREAMS_RESOURCE = 'cloudflare-streams';
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}
export function createCloudflareStreams(
  send: (body: string, signal?: AbortSignal) => Promise<StateResponse>
) {
  async function call(body: object, signal?: AbortSignal): Promise<unknown> {
    const response = await send(JSON.stringify(body), signal);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Cloudflare streams failed (HTTP ${response.status})`);
    }
    return response.json();
  }
  return {
    async add(
      stream: string,
      payload: Record<string, JsonValue>,
      maxlen?: number
    ): Promise<string> {
      return z
        .object({ id: z.string() })
        .parse(await call({ operation: 'add', stream, payload, maxlen })).id;
    },
    async head(stream: string): Promise<string> {
      return z
        .object({ id: z.string() })
        .parse(await call({ operation: 'head', stream })).id;
    },
    async read(
      streams: string[],
      ids: string[],
      options: { count?: number; block?: number; signal?: AbortSignal } = {}
    ): Promise<StreamMessage[]> {
      z.number().int().min(0).max(2147483647).optional().parse(options.block);
      options.signal?.throwIfAborted();
      // Resolve '$' once: repeating it after a bounded wait would skip events
      // appended between requests. Persistent heads also survive trimming.
      const positions = await Promise.all(
        ids.map(async (id, index) => {
          if (id !== '$' || !streams[index]) return id;
          return z
            .object({ id: z.string() })
            .parse(
              await call(
                { operation: 'head', stream: streams[index] },
                options.signal
              )
            ).id;
        })
      );
      const deadline =
        options.block === 0 ? Infinity : Date.now() + (options.block ?? 0);
      while (true) {
        options.signal?.throwIfAborted();
        const rows = z
          .array(
            z.object({
              stream: z.string(),
              id: z.string(),
              payload: z.record(z.string(), z.unknown()),
            })
          )
          .parse(
            await call(
              {
                operation: 'read',
                streams,
                ids: positions,
                count: options.count,
                // Cancellation is not reliably propagated through every HTTP hop.
                // Bound server waiters even when the caller requests an indefinite read.
                block:
                  options.block === undefined
                    ? undefined
                    : Math.max(1, Math.min(1000, deadline - Date.now())),
              },
              options.signal
            )
          );
        if (
          rows.length ||
          options.block === undefined ||
          Date.now() >= deadline
        )
          return rows;
      }
    },
    async health() {
      return z
        .object({
          healthy: z.literal(true),
          pendingReads: z.number().int().nonnegative(),
        })
        .parse(await call({ operation: 'health' }));
    },
  };
}
export function cloudflareStreams() {
  const resource =
    getRequestResource<ReturnType<typeof createCloudflareStreams>>(
      STREAMS_RESOURCE
    );
  if (resource) return resource;
  if (process.env.STREAMS_BACKEND === 'cloudflare')
    throw new Error('Cloudflare streams binding unavailable');
  if (process.env.STREAMS_BACKEND && process.env.STREAMS_BACKEND !== 'redis')
    throw new Error('Unsupported streams backend');
  return undefined;
}
