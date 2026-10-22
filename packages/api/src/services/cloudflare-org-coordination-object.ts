import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';
import { orgReactionSchema } from './cloudflare-org-coordination';

const pair = { orgId: z.string().min(1), eventId: z.string().min(1) };
const schema = z.discriminatedUnion('operation', [
  z
    .object({ operation: z.literal('record'), ...pair, reaction: z.string() })
    .strict(),
  z.object({ operation: z.literal('read'), ...pair }).strict(),
  z.object({ operation: z.literal('count'), ...pair }).strict(),
]);
const TTL_MS = 12 * 60 * 60 * 1000;
export class FeedOrgCoordination {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS org_events (org_id TEXT NOT NULL,event_id TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(org_id,event_id))'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS org_events_expiry ON org_events(expires_at)'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS org_reactions (org_id TEXT NOT NULL,event_id TEXT NOT NULL,reaction TEXT NOT NULL,timestamp REAL NOT NULL,PRIMARY KEY(org_id,event_id,reaction))'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS org_reactions_order ON org_reactions(org_id,event_id,timestamp,reaction)'
    );
  }
  private prune(now: number): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM org_reactions WHERE (org_id,event_id) IN (SELECT org_id,event_id FROM org_events WHERE expires_at<=?)',
      now
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM org_events WHERE expires_at<=?',
      now
    );
  }
  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => this.prune(Date.now()));
    const next = this.ctx.storage.sql
      .exec<{ expires: number | null }>(
        'SELECT MIN(expires_at) AS expires FROM org_events'
      )
      .one().expires;
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 });
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError)
        return new Response('Invalid JSON', { status: 400 });
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return new Response('Invalid coordination operation', { status: 400 });
    const input = parsed.data;
    let timestamp = 0;
    if (input.operation === 'record') {
      let reaction: unknown;
      try {
        reaction = JSON.parse(input.reaction);
      } catch (error) {
        if (error instanceof SyntaxError)
          return new Response('Invalid reaction JSON', { status: 400 });
        throw error;
      }
      const value = orgReactionSchema.safeParse(reaction);
      if (!value.success || value.data.eventId !== input.eventId)
        return new Response('Invalid reaction', { status: 400 });
      timestamp = value.data.timestamp;
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
    }
    const result = this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      this.prune(now);
      if (input.operation === 'record') {
        this.ctx.storage.sql.exec(
          'INSERT INTO org_reactions (org_id,event_id,reaction,timestamp) VALUES (?,?,?,?) ON CONFLICT(org_id,event_id,reaction) DO UPDATE SET timestamp=excluded.timestamp',
          input.orgId,
          input.eventId,
          input.reaction,
          timestamp
        );
        this.ctx.storage.sql.exec(
          'INSERT INTO org_events (org_id,event_id,expires_at) VALUES (?,?,?) ON CONFLICT(org_id,event_id) DO UPDATE SET expires_at=excluded.expires_at',
          input.orgId,
          input.eventId,
          now + TTL_MS
        );
        return { success: true };
      }
      if (input.operation === 'count')
        return this.ctx.storage.sql
          .exec<{ count: number }>(
            'SELECT COUNT(*) AS count FROM org_reactions WHERE org_id=? AND event_id=?',
            input.orgId,
            input.eventId
          )
          .one();
      return this.ctx.storage.sql
        .exec<{ reaction: string }>(
          'SELECT reaction FROM org_reactions WHERE org_id=? AND event_id=? ORDER BY timestamp,reaction',
          input.orgId,
          input.eventId
        )
        .toArray()
        .map((row) => orgReactionSchema.parse(JSON.parse(row.reaction)));
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }
}
