import type { Task } from '@a2a-js/sdk';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { z } from 'zod';
import { projectTask, resolvePage, taskTimestamp } from './extended-task-store';
import { isValidTask, TASK_STATES } from './task-schema';

const paramsSchema = z
  .object({
    contextId: z.string().optional(),
    status: z
      .enum(TASK_STATES.filter((state) => state !== 'unknown'))
      .optional(),
    pageSize: z.number().int().positive().optional(),
    pageToken: z.string().optional(),
    historyLength: z.number().int().nonnegative().optional(),
    includeArtifacts: z.boolean().optional(),
    lastUpdatedAfter: z.number().finite().optional(),
  })
  .strict();
const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('health') }).strict(),
  z
    .object({
      operation: z.literal('save'),
      raw: z.string(),
      ttl: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER / 1000),
      maxIndex: z.number().int().positive().safe(),
    })
    .strict(),
  z.object({ operation: z.literal('load'), taskId: z.string() }).strict(),
  z.object({ operation: z.literal('list'), params: paramsSchema }).strict(),
  z.object({ operation: z.literal('all') }).strict(),
  z.object({ operation: z.literal('clear') }).strict(),
]);
export class FeedTasks {
  constructor(private readonly ctx: DurableObjectState) {
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,context_id TEXT NOT NULL,state TEXT NOT NULL,updated_at REAL NOT NULL,status_at REAL NOT NULL,has_timestamp INTEGER NOT NULL,expires_at INTEGER NOT NULL)'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS tasks_expiry ON tasks(expires_at)'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS task_chunks (task_id TEXT NOT NULL,part INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(task_id,part))'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS task_indexes (kind TEXT NOT NULL,name TEXT NOT NULL,task_id TEXT NOT NULL,score REAL NOT NULL,PRIMARY KEY(kind,name,task_id))'
    );
    ctx.storage.sql.exec(
      'CREATE INDEX IF NOT EXISTS task_index_order ON task_indexes(kind,name,score,task_id)'
    );
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS task_index_expiry (kind TEXT NOT NULL,name TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(kind,name))'
    );
  }
  private prune(now: number): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM task_chunks WHERE task_id IN (SELECT id FROM tasks WHERE expires_at<=?)',
      now
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM task_indexes WHERE task_id IN (SELECT id FROM tasks WHERE expires_at<=?) OR (kind,name) IN (SELECT kind,name FROM task_index_expiry WHERE expires_at<=?)',
      now,
      now
    );
    this.ctx.storage.sql.exec('DELETE FROM tasks WHERE expires_at<=?', now);
    this.ctx.storage.sql.exec(
      'DELETE FROM task_index_expiry WHERE expires_at<=?',
      now
    );
  }
  private load(id: string): Task | null {
    const chunks = this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>(
        'SELECT data FROM task_chunks WHERE task_id=? ORDER BY part',
        id
      )
      .toArray();
    if (!chunks.length) return null;
    const bytes = new Uint8Array(
      chunks.reduce((length, row) => length + row.data.byteLength, 0)
    );
    let offset = 0;
    for (const row of chunks) {
      bytes.set(new Uint8Array(row.data), offset);
      offset += row.data.byteLength;
    }
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    );
    if (!isValidTask(value) || value.id !== id)
      throw new Error('Corrupt persisted task');
    return value;
  }
  async alarm(): Promise<void> {
    this.ctx.storage.transactionSync(() => this.prune(Date.now()));
    const next = this.ctx.storage.sql
      .exec<{ expires: number | null }>(
        'SELECT MIN(expires_at) AS expires FROM (SELECT expires_at FROM tasks UNION ALL SELECT expires_at FROM task_index_expiry)'
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
      return new Response('Invalid task operation', { status: 400 });
    const input = parsed.data;
    if (input.operation === 'health') {
      this.ctx.storage.sql.exec('SELECT 1 FROM tasks LIMIT 1').toArray();
      return Response.json(
        { healthy: true },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    let saved: Task | undefined;
    if (input.operation === 'save') {
      let value: unknown;
      try {
        value = JSON.parse(input.raw);
      } catch (error) {
        if (error instanceof SyntaxError)
          return new Response('Invalid task JSON', { status: 400 });
        throw error;
      }
      if (!isValidTask(value))
        return new Response('Invalid task', { status: 400 });
      saved = value;
      const next = Date.now() + input.ttl * 1000;
      if (!Number.isSafeInteger(next))
        return new Response('Invalid task expiry', { status: 400 });
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next);
    }
    if (input.operation === 'list') {
      try {
        const page = resolvePage(input.params);
        if (!Number.isSafeInteger(page.offset))
          throw new Error('Invalid offset');
      } catch {
        return new Response('Invalid pagination', { status: 400 });
      }
    }
    const result = this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      this.prune(now);
      if (input.operation === 'clear') {
        for (const table of [
          'task_chunks',
          'task_indexes',
          'task_index_expiry',
          'tasks',
        ])
          this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
        return { success: true };
      }
      if (input.operation === 'save' && saved) {
        const task = saved;
        const expires = now + input.ttl * 1000;
        const score = taskTimestamp(task) || now;
        this.ctx.storage.sql.exec(
          'INSERT INTO tasks (id,context_id,state,updated_at,status_at,has_timestamp,expires_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET context_id=excluded.context_id,state=excluded.state,updated_at=excluded.updated_at,status_at=excluded.status_at,has_timestamp=excluded.has_timestamp,expires_at=excluded.expires_at',
          task.id,
          task.contextId,
          task.status.state,
          score,
          taskTimestamp(task),
          task.status.timestamp === undefined ? 0 : 1,
          expires
        );
        this.ctx.storage.sql.exec(
          'DELETE FROM task_chunks WHERE task_id=?',
          task.id
        );
        const bytes = new TextEncoder().encode(input.raw);
        for (
          let start = 0, part = 0;
          start < bytes.length;
          start += 1024 * 1024, part++
        )
          this.ctx.storage.sql.exec(
            'INSERT INTO task_chunks (task_id,part,data) VALUES (?,?,?)',
            task.id,
            part,
            bytes.slice(start, start + 1024 * 1024).buffer
          );
        // Moving a task between contexts must not leave it visible to its prior owner.
        this.ctx.storage.sql.exec(
          'DELETE FROM task_indexes WHERE task_id=? AND ((kind=? AND name<>?) OR (kind=? AND name<>?))',
          task.id,
          'context',
          task.contextId || 'global',
          'status',
          task.status.state
        );
        for (const [kind, name] of [
          ['context', task.contextId || 'global'],
          ['status', task.status.state],
        ]) {
          this.ctx.storage.sql.exec(
            'INSERT INTO task_indexes (kind,name,task_id,score) VALUES (?,?,?,?) ON CONFLICT(kind,name,task_id) DO UPDATE SET score=excluded.score',
            kind!,
            name!,
            task.id,
            score
          );
          this.ctx.storage.sql.exec(
            'DELETE FROM task_indexes WHERE kind=? AND name=? AND task_id NOT IN (SELECT task_id FROM task_indexes WHERE kind=? AND name=? ORDER BY score DESC,task_id DESC LIMIT ?)',
            kind!,
            name!,
            kind!,
            name!,
            input.maxIndex
          );
          this.ctx.storage.sql.exec(
            'INSERT INTO task_index_expiry (kind,name,expires_at) VALUES (?,?,?) ON CONFLICT(kind,name) DO UPDATE SET expires_at=excluded.expires_at',
            kind!,
            name!,
            expires
          );
        }
        return { success: true };
      }
      if (input.operation === 'load') return this.load(input.taskId);
      if (input.operation === 'all')
        return this.ctx.storage.sql
          .exec<{ id: string }>(
            'SELECT id FROM tasks ORDER BY updated_at DESC,id DESC'
          )
          .toArray()
          .map((row) => this.load(row.id));
      if (input.operation === 'list') {
        const params = input.params;
        const page = resolvePage(params);
        const conditions: string[] = [];
        const values: (string | number)[] = [];
        if (params.contextId) {
          conditions.push(
            "id IN (SELECT task_id FROM task_indexes WHERE kind='context' AND name=?)"
          );
          values.push(params.contextId);
        }
        if (params.status) {
          conditions.push('state=?');
          values.push(params.status);
          if (params.contextId) {
            conditions.push(
              "id IN (SELECT task_id FROM task_indexes WHERE kind='status' AND name=?)"
            );
            values.push(params.status);
          }
        }
        if (params.lastUpdatedAfter !== undefined) {
          conditions.push(
            params.contextId
              ? 'updated_at>=?'
              : 'has_timestamp=1 AND status_at>=?'
          );
          values.push(params.lastUpdatedAfter);
        }
        const where = conditions.length
          ? ' WHERE ' + conditions.join(' AND ')
          : '';
        const total = this.ctx.storage.sql
          .exec<{ count: number }>(
            'SELECT COUNT(*) AS count FROM tasks' + where,
            ...values
          )
          .one().count;
        const rows = this.ctx.storage.sql
          .exec<{ id: string }>(
            'SELECT id FROM tasks' +
              where +
              ` ORDER BY ${params.contextId ? 'updated_at' : 'status_at'} DESC,id DESC LIMIT ? OFFSET ?`,
            ...values,
            page.pageSize,
            page.offset
          )
          .toArray();
        const tasks = rows.map((row) => {
          const task = this.load(row.id);
          if (!task) throw new Error('Missing persisted task');
          return projectTask(task, params);
        });
        return {
          tasks,
          totalSize: total,
          pageSize: page.pageSize,
          nextPageToken:
            total > page.offset + page.pageSize
              ? String(page.offset + page.pageSize)
              : '',
        };
      }
      throw new Error('Invalid task operation state');
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }
}
