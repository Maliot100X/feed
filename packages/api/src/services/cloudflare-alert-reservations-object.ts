import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';

const identity = {
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  token: z.string().uuid(),
};
const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('health') }).strict(),
  z
    .object({
      operation: z.literal('reserve'),
      ...identity,
      ttlSeconds: z.number().int().min(1).max(1800),
    })
    .strict(),
  z.object({ operation: z.literal('release'), ...identity }).strict(),
]);
/** Atomic incident reservation; only its owner may release it after failure. */
export class FeedAlertReservations {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS alert_reservations (fingerprint TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL)'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS alert_reservations_expiry ON alert_reservations(expires_at)'
    );
  }
  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec(
      'DELETE FROM alert_reservations WHERE expires_at<=?',
      Date.now()
    );
    const next = this.ctx.storage.sql
      .exec<{ expires: number | null }>(
        'SELECT MIN(expires_at) AS expires FROM alert_reservations'
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
      return new Response('Invalid alert operation', { status: 400 });
    const input = parsed.data;
    if (input.operation === 'health') {
      this.ctx.storage.sql
        .exec('SELECT 1 FROM alert_reservations LIMIT 1')
        .toArray();
      return Response.json(
        { healthy: true },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    if (input.operation === 'reserve') {
      const next = Date.now() + input.ttlSeconds * 1000;
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next);
    }
    const result = this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      this.ctx.storage.sql.exec(
        'DELETE FROM alert_reservations WHERE expires_at<=?',
        now
      );
      if (input.operation === 'release') {
        this.ctx.storage.sql.exec(
          'DELETE FROM alert_reservations WHERE fingerprint=? AND token=?',
          input.fingerprint,
          input.token
        );
        return { success: true };
      }
      if (
        this.ctx.storage.sql
          .exec(
            'SELECT fingerprint FROM alert_reservations WHERE fingerprint=?',
            input.fingerprint
          )
          .toArray().length
      )
        return { reserved: false };
      this.ctx.storage.sql.exec(
        'INSERT INTO alert_reservations (fingerprint,token,expires_at) VALUES (?,?,?)',
        input.fingerprint,
        input.token,
        now + input.ttlSeconds * 1000
      );
      return { reserved: true };
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }
}
