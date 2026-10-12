/**
 * Persistent Task Store
 *
 * Extends ExtendedTaskStore with Redis-backed persistence so tasks survive
 * restarts and are visible across instances (e.g. Cloudflare Worker isolates).
 *
 * - Writes go to the local store and, when Redis is available, to Redis.
 * - Reads prefer Redis when available (another instance may have updated the
 *   task); the local store is used when Redis is unavailable or the task was
 *   only saved locally.
 * - Individual and batch reads share one parser/validator.
 *
 * @public
 */

import type { Task } from '@a2a-js/sdk';
import { getRedisClient, isRedisAvailable } from '@feed/api';
import { logger } from '@feed/shared';
import { z } from 'zod';
import {
  ExtendedTaskStore,
  type ListTasksParams,
  type ListTasksResult,
  projectTask,
  resolvePage,
  taskTimestamp,
} from './extended-task-store';

const TASK_STATES = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
] as const;

/**
 * Zod schema for TaskStatus validation
 */
const TaskStatusSchema = z.object({
  state: z.enum(TASK_STATES),
  timestamp: z.string().optional(),
  message: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Zod schema for full Task validation
 * Validates all required properties according to the A2A SDK Task interface
 */
const TaskSchema = z.object({
  id: z.string(),
  contextId: z.string(),
  kind: z.literal('task'),
  status: TaskStatusSchema,
  artifacts: z.array(z.record(z.string(), z.unknown())).optional(),
  history: z.array(z.record(z.string(), z.unknown())).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function isValidTask(obj: unknown): obj is Task {
  return TaskSchema.safeParse(obj).success;
}

/**
 * Parse a stored task. Accepts the current single-encoded JSON and the legacy
 * double-encoded form (a JSON string containing JSON) written by earlier
 * versions via setCache. Returns undefined for corrupt or invalid entries.
 */
export function parseStoredTask(raw: string, taskId: string): Task | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
  } catch (error) {
    logger.warn(
      'Failed to parse task from Redis, treating as cache miss',
      { taskId, error: String(error) },
      'A2A'
    );
    return undefined;
  }
  if (!isValidTask(parsed)) {
    logger.warn(
      'Invalid task structure in Redis, treating as cache miss',
      { taskId },
      'A2A'
    );
    return undefined;
  }
  return parsed;
}

/**
 * Status update for task status changes
 */
export interface TaskStatusUpdate {
  state: Task['status']['state'];
  timestamp?: string;
  message?: Task['status']['message'];
}

const TASK_CACHE_NAMESPACE = 'a2a:tasks';
const TASK_INDEX_NAMESPACE = 'a2a:task-index';

// Environment-configurable constants with sensible defaults
const DEFAULT_TTL_SECONDS =
  Number(process.env.A2A_TASK_TTL_SECONDS) || 7 * 24 * 60 * 60; // 7 days
const MAX_INDEX_SIZE = Number(process.env.A2A_MAX_INDEX_SIZE) || 1000;
const CLEANUP_INTERVAL_MS =
  Number(process.env.A2A_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000; // 1 hour

function taskKey(taskId: string): string {
  return `${TASK_CACHE_NAMESPACE}:task:${taskId}`;
}

function contextIndexKey(contextId: string): string {
  return `${TASK_INDEX_NAMESPACE}:context:${contextId}`;
}

function statusIndexKey(status: string): string {
  return `${TASK_INDEX_NAMESPACE}:status:${status}`;
}

/**
 * Persistent task store with Redis backing
 */
export class PersistentTaskStore extends ExtendedTaskStore {
  private lastCleanup = Date.now();

  /**
   * Periodically evict local entries older than the persistence TTL so the
   * local store cannot grow without bound or serve tasks Redis has expired.
   */
  private maybeCleanupMemory(): void {
    const now = Date.now();
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastCleanup = now;

    const cutoff = now - DEFAULT_TTL_SECONDS * 1000;
    for (const [taskId, task] of this.tasks.entries()) {
      if (taskTimestamp(task) < cutoff) {
        this.tasks.delete(taskId);
      }
    }
  }

  private redis() {
    return isRedisAvailable() ? getRedisClient() : null;
  }

  /**
   * Save task locally and, when available, to Redis with its indexes.
   */
  async save(task: Task): Promise<void> {
    this.maybeCleanupMemory();
    await super.save(task);

    const client = this.redis();
    if (!client) return;

    const contextId = task.contextId || 'global';
    const timestamp = taskTimestamp(task) || Date.now();
    const contextKey = contextIndexKey(contextId);
    const statusKey = statusIndexKey(task.status.state);

    try {
      const multi = client.multi();
      multi.set(
        taskKey(task.id),
        JSON.stringify(task),
        'EX',
        DEFAULT_TTL_SECONDS
      );
      multi.zadd(contextKey, timestamp, task.id);
      multi.zremrangebyrank(contextKey, 0, -(MAX_INDEX_SIZE + 1));
      multi.expire(contextKey, DEFAULT_TTL_SECONDS);
      // A task belongs to exactly one status index.
      for (const state of TASK_STATES) {
        if (state !== task.status.state) {
          multi.zrem(statusIndexKey(state), task.id);
        }
      }
      multi.zadd(statusKey, timestamp, task.id);
      multi.zremrangebyrank(statusKey, 0, -(MAX_INDEX_SIZE + 1));
      multi.expire(statusKey, DEFAULT_TTL_SECONDS);
      const results = await multi.exec();
      const failed =
        results === null || results.some(([cmdErr]) => cmdErr !== null);
      if (failed) {
        logger.warn(
          'Failed to persist task to Redis, task is held locally only',
          { taskId: task.id },
          'A2A'
        );
      }
    } catch (error) {
      logger.warn(
        'Failed to persist task to Redis, task is held locally only',
        { taskId: task.id, error: String(error) },
        'A2A'
      );
    }
  }

  /**
   * Update a task's status, preserving other task fields.
   *
   * This is a load-modify-save and is NOT atomic across concurrent writers:
   * a concurrent save of the same task can overwrite (or be overwritten by)
   * this update.
   */
  async updateStatus(
    taskId: string,
    statusUpdate: TaskStatusUpdate
  ): Promise<Task | undefined> {
    const task = await this.load(taskId);
    if (!task) return undefined;

    const updatedTask: Task = {
      ...task,
      status: {
        ...task.status,
        state: statusUpdate.state,
        timestamp: statusUpdate.timestamp ?? new Date().toISOString(),
        ...(statusUpdate.message !== undefined && {
          message: statusUpdate.message,
        }),
      },
    };

    await this.save(updatedTask);
    return updatedTask;
  }

  /**
   * Load a task, preferring Redis when it is available.
   */
  async load(taskId: string): Promise<Task | undefined> {
    this.maybeCleanupMemory();

    const client = this.redis();
    if (client) {
      try {
        const raw = await client.get(taskKey(taskId));
        const task = raw ? parseStoredTask(raw, taskId) : undefined;
        if (task) {
          await super.save(task);
          return task;
        }
      } catch (error) {
        logger.warn(
          'Failed to load task from Redis, using local store',
          { taskId, error: String(error) },
          'A2A'
        );
      }
    }

    return super.load(taskId);
  }

  /**
   * Load multiple tasks: Redis (single MGET) when available, local store for
   * anything Redis does not have.
   */
  private async loadBatch(taskIds: string[]): Promise<Map<string, Task>> {
    const results = new Map<string, Task>();
    if (taskIds.length === 0) return results;

    const client = this.redis();
    if (client) {
      try {
        const values = await client.mget(...taskIds.map(taskKey));
        for (const [index, taskId] of taskIds.entries()) {
          const raw = values[index];
          const task = raw ? parseStoredTask(raw, taskId) : undefined;
          if (task) {
            results.set(taskId, task);
            await super.save(task);
          }
        }
      } catch (error) {
        logger.warn(
          'Failed to batch load tasks from Redis, using local store',
          { error: String(error) },
          'A2A'
        );
      }
    }

    for (const taskId of taskIds) {
      if (!results.has(taskId)) {
        const local = await super.load(taskId);
        if (local) results.set(taskId, local);
      }
    }
    return results;
  }

  /**
   * List tasks. With a contextId and Redis available, the Redis indexes are
   * authoritative; otherwise (or if Redis has nothing for the context) the
   * local store is listed.
   */
  async list(params: ListTasksParams = {}): Promise<ListTasksResult> {
    // Validate pagination up front so invalid input is never mistaken for a
    // Redis failure below.
    resolvePage(params);

    if (params.contextId && this.redis()) {
      try {
        const redisResult = await this.listFromRedis(params);
        if (redisResult.totalSize > 0) {
          return redisResult;
        }
      } catch (error) {
        logger.warn(
          'Failed to list tasks from Redis, falling back to local store',
          { error: String(error) },
          'A2A'
        );
      }
    }

    return super.list(params);
  }

  /**
   * Read an index (newest first).
   */
  private async readIndex(
    indexKey: string
  ): Promise<Array<{ taskId: string; timestamp: number }>> {
    const client = this.redis();
    if (!client) return [];

    const results = await client.zrevrange(indexKey, 0, -1, 'WITHSCORES');
    const entries: Array<{ taskId: string; timestamp: number }> = [];
    for (let i = 0; i < results.length; i += 2) {
      const taskId = results[i];
      const score = results[i + 1];
      if (taskId && score) {
        entries.push({ taskId, timestamp: Number.parseFloat(score) });
      }
    }
    return entries;
  }

  /**
   * List tasks from Redis using sorted set indexes
   */
  private async listFromRedis(
    params: ListTasksParams
  ): Promise<ListTasksResult> {
    const { offset, pageSize } = resolvePage(params);
    let entries = await this.readIndex(
      contextIndexKey(params.contextId || 'global')
    );

    if (params.status) {
      const statusIds = new Set(
        (await this.readIndex(statusIndexKey(params.status))).map(
          (e) => e.taskId
        )
      );
      entries = entries.filter((e) => statusIds.has(e.taskId));
    }

    if (params.lastUpdatedAfter !== undefined) {
      entries = entries.filter((e) => e.timestamp >= params.lastUpdatedAfter!);
    }

    const pageIds = entries
      .slice(offset, offset + pageSize)
      .map((e) => e.taskId);
    const loaded = await this.loadBatch(pageIds);

    const tasks: Task[] = [];
    for (const taskId of pageIds) {
      const task = loaded.get(taskId);
      if (task) tasks.push(projectTask(task, params));
    }

    const end = offset + pageSize;
    return {
      tasks,
      totalSize: entries.length,
      pageSize,
      nextPageToken: entries.length > end ? String(end) : '',
    };
  }
}
