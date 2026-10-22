import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';

const inputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('check'),
    userId: z.string().min(1),
    actionType: z.string().min(1),
    windowMs: z.number().int().positive().safe(),
    maxRequests: z.number().int().positive().safe(),
  }),
  z.object({
    operation: z.literal('status'),
    userId: z.string().min(1),
    actionType: z.string().min(1),
    windowMs: z.number().int().positive().safe(),
    maxRequests: z.number().int().positive().safe(),
  }),
  z.object({
    operation: z.literal('reset'),
    userId: z.string().min(1),
    actionType: z.string().min(1),
  }),
  z.object({ operation: z.literal('clear') }),
]);

/** One private binding per deployment preserves cross-request admission. */
export class FeedRateLimits {
  private readonly ctx: DurableObjectState;
  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS rate_keys (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS rate_events (key TEXT NOT NULL, member TEXT NOT NULL, time INTEGER NOT NULL, PRIMARY KEY (key, member))'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS rate_events_time ON rate_events (key, time)'
    );
  }

  private prune(now: number): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM rate_events WHERE key IN (SELECT key FROM rate_keys WHERE expires_at <= ?)',
      now
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM rate_keys WHERE expires_at <= ?',
      now
    );
  }

  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => this.prune(Date.now()));
    const row = this.ctx.storage.sql
      .exec<{ count: number }>('SELECT COUNT(*) AS count FROM rate_keys')
      .toArray()[0];
    if (!row)
      throw new Error('Rate limit cleanup query did not return a result');
    if (row.count > 0) await this.ctx.storage.setAlarm(Date.now() + 60_000);
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
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success)
      return new Response('Invalid rate limit operation', { status: 400 });
    const input = parsed.data;
    const now = Date.now();
    if (
      (input.operation === 'check' || input.operation === 'status') &&
      (!Number.isSafeInteger(
        now + (Math.ceil(input.windowMs / 1000) + 10) * 1000
      ) ||
        now + input.windowMs > 8_640_000_000_000_000)
    ) {
      return new Response(
        'Rate limit expiration is outside the supported date range',
        { status: 400 }
      );
    }
    // Set the cleanup alarm before committing state. An alarm failure must not
    // acknowledge an admission whose request was never returned to the caller.
    if (
      input.operation === 'check' &&
      (await this.ctx.storage.getAlarm()) === null
    ) {
      await this.ctx.storage.setAlarm(now + 60_000);
    }
    const result = this.ctx.storage.transactionSync(() => {
      this.prune(now);
      if (input.operation === 'clear') {
        this.ctx.storage.sql.exec('DELETE FROM rate_events');
        this.ctx.storage.sql.exec('DELETE FROM rate_keys');
        return { cleared: true };
      }
      const key = `ratelimit:${input.actionType}:${input.userId}`;
      if (input.operation === 'reset') {
        this.ctx.storage.sql.exec('DELETE FROM rate_events WHERE key = ?', key);
        this.ctx.storage.sql.exec('DELETE FROM rate_keys WHERE key = ?', key);
        return { reset: true };
      }
      const start = now - input.windowMs;
      if (input.operation === 'check') {
        this.ctx.storage.sql.exec(
          'DELETE FROM rate_events WHERE key = ? AND time <= ?',
          key,
          start
        );
      }
      const row = this.ctx.storage.sql
        .exec<{ count: number; oldest: number | null }>(
          'SELECT COUNT(*) AS count, MIN(time) AS oldest FROM rate_events WHERE key = ? AND time >= ?',
          key,
          start
        )
        .toArray()[0];
      if (!row) throw new Error('Rate limit query did not return a result');
      if (input.operation === 'status') {
        return {
          count: row.count,
          remaining: Math.max(0, input.maxRequests - row.count),
          resetAtMs: (row.oldest ?? now) + input.windowMs,
        };
      }
      if (row.count >= input.maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.ceil(
            ((row.oldest ?? now) + input.windowMs - now) / 1000
          ),
        };
      }
      this.ctx.storage.sql.exec(
        'INSERT INTO rate_events (key, member, time) VALUES (?, ?, ?)',
        key,
        crypto.randomUUID(),
        now
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO rate_keys (key, expires_at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET expires_at = excluded.expires_at',
        key,
        now + (Math.ceil(input.windowMs / 1000) + 10) * 1000
      );
      return { allowed: true, remaining: input.maxRequests - row.count - 1 };
    });
    return Response.json(result);
  }
}
