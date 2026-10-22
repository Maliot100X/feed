import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';
import { cacheGlobToRegExp } from './cache-pattern';

const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('health') }).strict(),
  z.object({ operation: z.literal('get'), key: z.string() }).strict(),
  z.object({ operation: z.literal('ttl'), key: z.string() }).strict(),
  z
    .object({ operation: z.literal('mget'), keys: z.array(z.string()) })
    .strict(),
  z
    .object({
      operation: z.literal('set'),
      entries: z.array(z.tuple([z.string(), z.string()])),
      ttl: z.number().int().positive().safe(),
    })
    .strict(),
  z
    .object({ operation: z.literal('delete'), keys: z.array(z.string()) })
    .strict(),
  z
    .object({ operation: z.literal('invalidate'), pattern: z.string() })
    .strict(),
  z.object({ operation: z.literal('clear') }).strict(),
]);
export class FeedCache {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS cache_entries (key TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS cache_expiry ON cache_entries(expires_at)'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS cache_chunks (key TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(key,part))'
    );
  }
  private prune(now: number) {
    this.ctx.storage.sql.exec(
      'DELETE FROM cache_chunks WHERE key IN (SELECT key FROM cache_entries WHERE expires_at<=?)',
      now
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM cache_entries WHERE expires_at<=?',
      now
    );
  }
  private remove(key: string) {
    this.ctx.storage.sql.exec('DELETE FROM cache_chunks WHERE key=?', key);
    this.ctx.storage.sql.exec('DELETE FROM cache_entries WHERE key=?', key);
  }
  private get(key: string): string | null {
    const chunks = this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>(
        'SELECT data FROM cache_chunks WHERE key=? ORDER BY part',
        key
      )
      .toArray();
    if (!chunks.length) return null;
    const bytes = new Uint8Array(
      chunks.reduce((sum, row) => sum + row.data.byteLength, 0)
    );
    let offset = 0;
    for (const row of chunks) {
      bytes.set(new Uint8Array(row.data), offset);
      offset += row.data.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  async alarm() {
    this.ctx.storage.transactionSync(() => this.prune(Date.now()));
    const next = this.ctx.storage.sql
      .exec<{ expires: number | null }>(
        'SELECT MIN(expires_at) AS expires FROM cache_entries'
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
      return new Response('Invalid cache operation', { status: 400 });
    const input = parsed.data;
    if (input.operation === 'health') {
      this.ctx.storage.sql
        .exec('SELECT 1 FROM cache_entries LIMIT 1')
        .toArray();
      return Response.json(
        { healthy: true },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    if (input.operation === 'set') {
      const expires = Date.now() + input.ttl * 1000;
      if (!Number.isSafeInteger(expires))
        return new Response('Invalid cache expiry', { status: 400 });
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > expires)
        await this.ctx.storage.setAlarm(expires);
    }
    const result = this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      this.prune(now);
      if (input.operation === 'get') return this.get(input.key);
      if (input.operation === 'mget')
        return input.keys.map((key) => this.get(key));
      if (input.operation === 'ttl') {
        const row = this.ctx.storage.sql
          .exec<{ expires_at: number }>(
            'SELECT expires_at FROM cache_entries WHERE key=?',
            input.key
          )
          .toArray()[0];
        return row ? Math.floor((row.expires_at - now) / 1000) : -2;
      }
      if (input.operation === 'clear') {
        this.ctx.storage.sql.exec('DELETE FROM cache_chunks');
        this.ctx.storage.sql.exec('DELETE FROM cache_entries');
      } else if (input.operation === 'delete')
        for (const key of input.keys) this.remove(key);
      else if (input.operation === 'invalidate') {
        const matcher = cacheGlobToRegExp(input.pattern);
        const keys = this.ctx.storage.sql
          .exec<{ key: string }>('SELECT key FROM cache_entries')
          .toArray();
        for (const { key } of keys) if (matcher.test(key)) this.remove(key);
      } else if (input.operation === 'set')
        for (const [key, value] of input.entries) {
          this.remove(key);
          this.ctx.storage.sql.exec(
            'INSERT INTO cache_entries(key,expires_at) VALUES (?,?)',
            key,
            now + input.ttl * 1000
          );
          const bytes = new TextEncoder().encode(value);
          // Keep an empty value distinguishable from a missing key.
          for (
            let start = 0, part = 0;
            start < Math.max(bytes.length, 1);
            start += 1024 * 1024, part++
          )
            this.ctx.storage.sql.exec(
              'INSERT INTO cache_chunks(key,part,data) VALUES (?,?,?)',
              key,
              part,
              bytes.slice(start, start + 1024 * 1024).buffer
            );
        }
      return { success: true };
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }
}
