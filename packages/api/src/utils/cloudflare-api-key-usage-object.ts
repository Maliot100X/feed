import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';
import { type UsageEntry, usageEntrySchema } from './cloudflare-api-key-usage';

const schema = z.discriminatedUnion('operation', [
  z
    .object({ operation: z.literal('record'), entry: usageEntrySchema })
    .strict(),
  z
    .object({
      operation: z.literal('batch'),
      limit: z.number().int().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      operation: z.literal('acknowledge'),
      entries: z.array(usageEntrySchema).max(1000),
    })
    .strict(),
]);
/** Persistent write-back buffer; acknowledgement compares each committed value. */
export class FeedApiKeyUsage {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS api_key_usage (key_id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL)'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS api_key_usage_timestamp ON api_key_usage(timestamp,key_id)'
    );
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
      return new Response('Invalid usage operation', { status: 400 });
    const input = parsed.data;
    const result = this.ctx.storage.transactionSync(() => {
      if (input.operation === 'batch')
        return this.ctx.storage.sql
          .exec<UsageEntry>(
            'SELECT key_id AS keyId,timestamp FROM api_key_usage ORDER BY timestamp,key_id LIMIT ?',
            input.limit
          )
          .toArray();
      if (input.operation === 'record')
        this.ctx.storage.sql.exec(
          'INSERT INTO api_key_usage (key_id,timestamp) VALUES (?,?) ON CONFLICT(key_id) DO UPDATE SET timestamp=MAX(api_key_usage.timestamp,excluded.timestamp)',
          input.entry.keyId,
          input.entry.timestamp
        );
      else
        for (const entry of input.entries)
          this.ctx.storage.sql.exec(
            'DELETE FROM api_key_usage WHERE key_id=? AND timestamp=?',
            entry.keyId,
            entry.timestamp
          );
      return { success: true };
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }
}
