/**
 * Extended Task Store
 *
 * In-memory implementation of the A2A SDK's TaskStore that adds tasks/list
 * (filtering, pagination and history projection) required for full A2A
 * protocol compliance. This class is the single in-memory store; it does not
 * also delegate to the SDK's InMemoryTaskStore, so clear() and eviction are
 * authoritative.
 *
 * @public
 */

import type { Task } from '@a2a-js/sdk';
import type { TaskStore } from '@a2a-js/sdk/server';

/**
 * Parameters for listing tasks
 */
export interface ListTasksParams {
  contextId?: string;
  status?:
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'auth-required'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'rejected';
  pageSize?: number;
  pageToken?: string;
  historyLength?: number;
  includeArtifacts?: boolean;
  lastUpdatedAfter?: number;
}

/**
 * Result of listing tasks
 */
export interface ListTasksResult {
  tasks: Task[];
  totalSize: number;
  pageSize: number;
  nextPageToken: string;
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/** Last status timestamp in ms, or 0 when absent/invalid. */
export function taskTimestamp(task: Task): number {
  if (!task.status.timestamp) return 0;
  const time = new Date(task.status.timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Validate pagination params and return the page window. pageSize above the
 * maximum is clamped to the maximum.
 * @throws Error for a non-integer or non-positive pageSize, a malformed
 * pageToken, or a negative/non-integer historyLength.
 */
export function resolvePage(params: ListTasksParams): {
  offset: number;
  pageSize: number;
} {
  let pageSize = DEFAULT_PAGE_SIZE;
  if (params.pageSize !== undefined) {
    if (!Number.isInteger(params.pageSize) || params.pageSize < 1) {
      throw new Error('Invalid pageSize: expected a positive integer');
    }
    pageSize = Math.min(params.pageSize, MAX_PAGE_SIZE);
  }

  let offset = 0;
  if (params.pageToken) {
    if (!/^\d+$/.test(params.pageToken)) {
      throw new Error(
        `Invalid pageToken: expected non-negative integer, got "${params.pageToken}"`
      );
    }
    offset = Number(params.pageToken);
  }

  if (
    params.historyLength !== undefined &&
    (!Number.isInteger(params.historyLength) || params.historyLength < 0)
  ) {
    throw new Error('Invalid historyLength: expected non-negative integer');
  }

  return { offset, pageSize };
}

/**
 * Project a task for a list response without mutating the stored task.
 * historyLength 0 returns an empty history.
 */
export function projectTask(task: Task, params: ListTasksParams): Task {
  const projected: Task = { ...task };
  if (params.historyLength !== undefined && projected.history) {
    projected.history =
      params.historyLength === 0
        ? []
        : projected.history.slice(-params.historyLength);
  }
  if (params.includeArtifacts === false) {
    delete projected.artifacts;
  }
  return projected;
}

/**
 * In-memory task store with list capability
 */
export class ExtendedTaskStore implements TaskStore {
  protected readonly tasks: Map<string, Task> = new Map();

  async save(task: Task): Promise<void> {
    this.tasks.set(task.id, { ...task });
  }

  async load(taskId: string): Promise<Task | undefined> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  /**
   * List tasks with filtering and pagination (most recently updated first).
   */
  async list(params: ListTasksParams = {}): Promise<ListTasksResult> {
    const { offset, pageSize } = resolvePage(params);

    const matching = Array.from(this.tasks.values())
      .filter(
        (task) =>
          (!params.contextId || task.contextId === params.contextId) &&
          (!params.status || task.status.state === params.status) &&
          (params.lastUpdatedAfter === undefined ||
            (task.status.timestamp !== undefined &&
              taskTimestamp(task) >= params.lastUpdatedAfter))
      )
      .sort((a, b) => taskTimestamp(b) - taskTimestamp(a));

    const end = offset + pageSize;
    return {
      tasks: matching
        .slice(offset, end)
        .map((task) => projectTask(task, params)),
      totalSize: matching.length,
      pageSize,
      nextPageToken: matching.length > end ? String(end) : '',
    };
  }

  /**
   * Get all tasks (for debugging/admin)
   */
  async getAllTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values(), (task) => ({ ...task }));
  }

  /**
   * Clear all tasks (for testing)
   */
  async clear(): Promise<void> {
    this.tasks.clear();
  }
}
