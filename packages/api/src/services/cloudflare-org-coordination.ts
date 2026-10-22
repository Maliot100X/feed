import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';
import type { OrgReaction } from './org-coordination-service';

export const ORG_COORDINATION_RESOURCE = 'cloudflare-org-coordination';
export const orgReactionSchema = z
  .object({
    npcId: z.string(),
    npcName: z.string(),
    eventId: z.string(),
    angle: z.string(),
    actionType: z.enum(['post', 'comment', 'trade']),
    sentiment: z.enum(['positive', 'negative', 'neutral', 'defensive']),
    timestamp: z.number().finite(),
  })
  .strict();
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}
export function createCloudflareOrgCoordination(
  send: (body: string) => Promise<StateResponse>
) {
  async function call(body: object): Promise<unknown> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare org coordination failed (HTTP ${response.status})`
      );
    }
    return response.json();
  }
  return {
    async record(orgId: string, reaction: OrgReaction): Promise<void> {
      z.object({ success: z.literal(true) }).parse(
        await call({
          operation: 'record',
          orgId,
          eventId: reaction.eventId,
          reaction: JSON.stringify(reaction),
        })
      );
    },
    async read(orgId: string, eventId: string): Promise<OrgReaction[]> {
      return z
        .array(orgReactionSchema)
        .parse(await call({ operation: 'read', orgId, eventId }));
    },
    async count(orgId: string, eventId: string): Promise<number> {
      return z
        .object({ count: z.number().int().nonnegative() })
        .parse(await call({ operation: 'count', orgId, eventId })).count;
    },
  };
}
export function cloudflareOrgCoordination() {
  const resource = getRequestResource<
    ReturnType<typeof createCloudflareOrgCoordination>
  >(ORG_COORDINATION_RESOURCE);
  if (resource) return resource;
  if (process.env.ORG_COORDINATION_BACKEND === 'cloudflare')
    throw new Error('Cloudflare org coordination binding unavailable');
  if (
    process.env.ORG_COORDINATION_BACKEND &&
    process.env.ORG_COORDINATION_BACKEND !== 'redis'
  )
    throw new Error('Unsupported org coordination backend');
  return undefined;
}
