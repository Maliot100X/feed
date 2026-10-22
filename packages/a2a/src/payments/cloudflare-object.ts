import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';

const key = z.string().regex(/^x402:(payment|tx):.+$/);
const ttl = z
  .number()
  .int()
  .positive()
  .max(90 * 24 * 60 * 60);
const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('get'), key }).strict(),
  z.object({ operation: z.literal('del'), key }).strict(),
  z
    .object({
      operation: z.literal('set'),
      key,
      value: z.string(),
      ttl: ttl.optional(),
      absent: z.boolean(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('keys'),
      pattern: z.enum(['x402:payment:*', 'x402:tx:*']),
    })
    .strict(),
]);

/** Private payment storage binding. All transaction claims share one object. */
export class FeedPayments {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS payment_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)'
    );
  }

  private prune(now: number): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM payment_state WHERE expires_at <= ?',
      now
    );
  }

  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => this.prune(Date.now()));
    const next = this.ctx.storage.sql
      .exec<{ expires: number | null }>(
        'SELECT MIN(expires_at) AS expires FROM payment_state'
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
      return new Response('Invalid payment storage operation', { status: 400 });
    const input = parsed.data;
    // Schedule cleanup before committing a new expiry. A failed alarm write
    // must reject the request instead of acknowledging partially stored state.
    if (input.operation === 'set' && input.ttl !== undefined) {
      const expires = Date.now() + input.ttl * 1000;
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > expires)
        await this.ctx.storage.setAlarm(expires);
    }
    const result = this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      this.prune(now);
      if (input.operation === 'get') {
        const row = this.ctx.storage.sql
          .exec<{ value: string }>(
            'SELECT value FROM payment_state WHERE key=?',
            input.key
          )
          .toArray()[0];
        return { value: row?.value ?? null };
      }
      if (input.operation === 'del') {
        this.ctx.storage.sql.exec(
          'DELETE FROM payment_state WHERE key=?',
          input.key
        );
        return { success: true };
      }
      if (input.operation === 'keys') {
        const prefix = input.pattern.slice(0, -1);
        return {
          keys: this.ctx.storage.sql
            .exec<{ key: string }>(
              'SELECT key FROM payment_state WHERE substr(key,1,?)=? ORDER BY key',
              prefix.length,
              prefix
            )
            .toArray()
            .map((row) => row.key),
        };
      }
      const present =
        this.ctx.storage.sql
          .exec('SELECT key FROM payment_state WHERE key=?', input.key)
          .toArray().length !== 0;
      if (input.absent && present) return { stored: false };
      this.ctx.storage.sql.exec(
        'INSERT INTO payment_state (key,value,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at',
        input.key,
        input.value,
        input.ttl === undefined ? null : now + input.ttl * 1000
      );
      return { stored: true };
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }
}
