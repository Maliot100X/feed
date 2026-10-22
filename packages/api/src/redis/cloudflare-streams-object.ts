import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';

const cursor = z.string().regex(/^(\$|\d{1,20}(-\d{1,20})?)$/);
const schema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('add'),
      stream: z.string().min(1),
      payload: z.record(z.string(), z.json()),
      maxlen: z.number().int().nonnegative().safe().optional(),
    })
    .strict(),
  z
    .object({ operation: z.literal('head'), stream: z.string().min(1) })
    .strict(),
  z
    .object({
      operation: z.literal('read'),
      streams: z.array(z.string().min(1)).min(1),
      ids: z.array(cursor).min(1),
      count: z.number().int().positive().safe().optional(),
      block: z.number().int().min(1).max(1000).optional(),
    })
    .strict(),
  z.object({ operation: z.literal('health') }).strict(),
]);
interface Position {
  ms: number;
  seq: number;
  future: boolean;
}
export class FeedStreams {
  private readonly waiters = new Set<() => void>();
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS stream_heads (name TEXT PRIMARY KEY,ms INTEGER NOT NULL,seq INTEGER NOT NULL)'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS stream_entries (name TEXT NOT NULL,ms INTEGER NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(name,ms,seq))'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS stream_chunks (name TEXT NOT NULL,ms INTEGER NOT NULL,seq INTEGER NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(name,ms,seq,part))'
    );
  }
  private head(name: string): string {
    const row = this.ctx.storage.sql
      .exec<{ ms: number; seq: number }>(
        'SELECT ms,seq FROM stream_heads WHERE name=?',
        name
      )
      .toArray()[0];
    return row ? `${row.ms}-${row.seq}` : '0-0';
  }
  private position(id: string): Position {
    const [msText, seqText = '0'] = id.split('-');
    const ms = BigInt(msText!);
    const seq = BigInt(seqText);
    return {
      ms: ms > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(ms),
      seq:
        seq > BigInt(Number.MAX_SAFE_INTEGER)
          ? Number.MAX_SAFE_INTEGER
          : Number(seq),
      future: ms > BigInt(Number.MAX_SAFE_INTEGER),
    };
  }
  private payload(
    name: string,
    ms: number,
    seq: number
  ): Record<string, unknown> {
    const chunks = this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>(
        'SELECT data FROM stream_chunks WHERE name=? AND ms=? AND seq=? ORDER BY part',
        name,
        ms,
        seq
      )
      .toArray();
    if (!chunks.length) throw new Error('Missing persisted stream payload');
    const bytes = new Uint8Array(
      chunks.reduce((sum, row) => sum + row.data.byteLength, 0)
    );
    let offset = 0;
    for (const row of chunks) {
      bytes.set(new Uint8Array(row.data), offset);
      offset += row.data.byteLength;
    }
    return z
      .record(z.string(), z.unknown())
      .parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      );
  }
  private read(streams: string[], positions: Position[], count?: number) {
    const result: Array<{
      stream: string;
      id: string;
      payload: Record<string, unknown>;
    }> = [];
    for (const [index, name] of streams.entries()) {
      const position = positions[index]!;
      if (position.future) continue;
      const rows = this.ctx.storage.sql
        .exec<{ ms: number; seq: number }>(
          'SELECT ms,seq FROM stream_entries WHERE name=? AND (ms>? OR (ms=? AND seq>?)) ORDER BY ms,seq' +
            (count === undefined ? '' : ' LIMIT ?'),
          name,
          position.ms,
          position.ms,
          position.seq,
          ...(count === undefined ? [] : [count])
        )
        .toArray();
      for (const row of rows)
        result.push({
          stream: name,
          id: `${row.ms}-${row.seq}`,
          payload: this.payload(name, row.ms, row.seq),
        });
    }
    return result;
  }
  private wait(deadline: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.waiters.delete(wake);
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const wake = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Stream read aborted', 'AbortError'));
      };
      this.waiters.add(wake);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      if (Number.isFinite(deadline))
        timer = setTimeout(wake, Math.max(0, deadline - Date.now()));
    });
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
      return new Response('Invalid stream operation', { status: 400 });
    const input = parsed.data;
    const reply = (value: unknown) =>
      Response.json(value, { headers: { 'cache-control': 'no-store' } });
    if (input.operation === 'health') {
      this.ctx.storage.sql.exec('SELECT 1 FROM stream_heads LIMIT 1').toArray();
      return reply({ healthy: true, pendingReads: this.waiters.size });
    }
    if (input.operation === 'head')
      return reply({ id: this.head(input.stream) });
    if (input.operation === 'add') {
      const id = this.ctx.storage.transactionSync(() => {
        const previous = this.position(this.head(input.stream));
        const ms = Math.max(Date.now(), previous.ms);
        const seq = ms === previous.ms ? previous.seq + 1 : 0;
        if (!Number.isSafeInteger(seq))
          throw new Error('Stream sequence exhausted');
        this.ctx.storage.sql.exec(
          'INSERT INTO stream_heads(name,ms,seq) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET ms=excluded.ms,seq=excluded.seq',
          input.stream,
          ms,
          seq
        );
        this.ctx.storage.sql.exec(
          'INSERT INTO stream_entries(name,ms,seq) VALUES (?,?,?)',
          input.stream,
          ms,
          seq
        );
        const bytes = new TextEncoder().encode(JSON.stringify(input.payload));
        for (
          let start = 0, part = 0;
          start < bytes.length;
          start += 1024 * 1024, part++
        )
          this.ctx.storage.sql.exec(
            'INSERT INTO stream_chunks(name,ms,seq,part,data) VALUES (?,?,?,?,?)',
            input.stream,
            ms,
            seq,
            part,
            bytes.slice(start, start + 1024 * 1024).buffer
          );
        if (input.maxlen !== undefined) {
          this.ctx.storage.sql.exec(
            'DELETE FROM stream_entries WHERE name=? AND (ms,seq) NOT IN (SELECT ms,seq FROM stream_entries WHERE name=? ORDER BY ms DESC,seq DESC LIMIT ?)',
            input.stream,
            input.stream,
            input.maxlen
          );
          this.ctx.storage.sql.exec(
            'DELETE FROM stream_chunks WHERE name=? AND (ms,seq) NOT IN (SELECT ms,seq FROM stream_entries WHERE name=?)',
            input.stream,
            input.stream
          );
        }
        return `${ms}-${seq}`;
      });
      for (const wake of [...this.waiters]) wake();
      return reply({ id });
    }
    if (input.streams.length !== input.ids.length)
      return new Response('Stream/cursor counts differ', { status: 400 });
    const positions = input.ids.map((id, index) =>
      this.position(id === '$' ? this.head(input.streams[index]!) : id)
    );
    const deadline = Date.now() + (input.block ?? 0);
    while (true) {
      if (request.signal.aborted)
        throw new DOMException('Stream read aborted', 'AbortError');
      const rows = this.read(input.streams, positions, input.count);
      if (rows.length || input.block === undefined || Date.now() >= deadline)
        return reply(rows);
      await this.wait(deadline, request.signal);
    }
  }
}
