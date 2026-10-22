import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';

const inputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('health') }).strict(),
  z
    .object({
      operation: z.literal('register'),
      userId: z.string().min(1),
      platform: z.enum(['ios', 'android']),
      token: z.string().min(1).max(4096),
    })
    .strict(),
  z
    .object({ operation: z.literal('remove'), userId: z.string().min(1) })
    .strict(),
  z
    .object({ operation: z.literal('list'), userId: z.string().min(1) })
    .strict(),
]);
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Private binding only. The caller supplies the authenticated account ID. */
export class FeedDevices {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS device_users (user_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS devices (user_id TEXT NOT NULL, token TEXT NOT NULL, platform TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, token))'
    );
  }

  private prune(now: number): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM devices WHERE user_id IN (SELECT user_id FROM device_users WHERE expires_at <= ?)',
      now
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM device_users WHERE expires_at <= ?',
      now
    );
  }

  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => this.prune(Date.now()));
    const row = this.ctx.storage.sql
      .exec<{ expires: number | null }>(
        'SELECT MIN(expires_at) AS expires FROM device_users'
      )
      .one();
    if (row.expires !== null) await this.ctx.storage.setAlarm(row.expires);
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
      return new Response('Invalid device operation', { status: 400 });
    const input = parsed.data;
    if (input.operation === 'health') {
      this.ctx.storage.sql.exec('SELECT 1 FROM device_users LIMIT 1').toArray();
      return Response.json(
        { healthy: true },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    const now = Date.now();
    if (
      input.operation === 'register' &&
      (await this.ctx.storage.getAlarm()) === null
    ) {
      await this.ctx.storage.setAlarm(now + TTL_MS);
    }
    const result = this.ctx.storage.transactionSync(() => {
      this.prune(now);
      if (input.operation === 'register') {
        this.ctx.storage.sql.exec(
          'INSERT INTO devices (user_id,token,platform,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,token) DO UPDATE SET platform=excluded.platform,updated_at=excluded.updated_at',
          input.userId,
          input.token,
          input.platform,
          now
        );
        // Redis expires the entire user hash, not each individual token.
        this.ctx.storage.sql.exec(
          'INSERT INTO device_users (user_id,expires_at) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at',
          input.userId,
          now + TTL_MS
        );
        return { success: true };
      }
      if (input.operation === 'remove') {
        this.ctx.storage.sql.exec(
          'DELETE FROM devices WHERE user_id=?',
          input.userId
        );
        this.ctx.storage.sql.exec(
          'DELETE FROM device_users WHERE user_id=?',
          input.userId
        );
        return { success: true };
      }
      const devices = this.ctx.storage.sql
        .exec<{
          platform: 'ios' | 'android';
          token: string;
          updatedAt: number;
        }>(
          'SELECT platform,token,updated_at AS updatedAt FROM devices WHERE user_id=? ORDER BY token',
          input.userId
        )
        .toArray();
      const user = this.ctx.storage.sql
        .exec<{ expiresAt: number }>(
          'SELECT expires_at AS expiresAt FROM device_users WHERE user_id=?',
          input.userId
        )
        .toArray()[0];
      return { devices, expiresAt: user?.expiresAt ?? null };
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }
}
