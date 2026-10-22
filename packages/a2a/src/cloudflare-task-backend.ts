import type { Task } from '@a2a-js/sdk';
import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';
import type { ListTasksParams, ListTasksResult } from './extended-task-store';
import { isValidTask } from './task-schema';

export const TASK_STORAGE_RESOURCE = 'cloudflare-task-storage';
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}
function task(value: unknown): Task {
  if (!isValidTask(value))
    throw new Error('Invalid task returned by Cloudflare storage');
  return value;
}
export function createCloudflareTaskStore(
  send: (body: string) => Promise<StateResponse>
) {
  async function call(body: object): Promise<unknown> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare task storage failed (HTTP ${response.status})`
      );
    }
    return response.json();
  }
  return {
    async save(value: Task, ttl: number, maxIndex: number): Promise<void> {
      z.object({ success: z.literal(true) }).parse(
        await call({
          operation: 'save',
          raw: JSON.stringify(value),
          ttl,
          maxIndex,
        })
      );
    },
    async load(taskId: string): Promise<Task | undefined> {
      const value = await call({ operation: 'load', taskId });
      return value === null ? undefined : task(value);
    },
    async list(params: ListTasksParams): Promise<ListTasksResult> {
      const result = z
        .object({
          tasks: z.array(z.unknown()),
          totalSize: z.number().int().nonnegative(),
          pageSize: z.number().int().positive(),
          nextPageToken: z.string(),
        })
        .parse(await call({ operation: 'list', params }));
      return { ...result, tasks: result.tasks.map(task) };
    },
    async clear(): Promise<void> {
      z.object({ success: z.literal(true) }).parse(
        await call({ operation: 'clear' })
      );
    },
    async all(): Promise<Task[]> {
      return z
        .array(z.unknown())
        .parse(await call({ operation: 'all' }))
        .map(task);
    },
  };
}
export function cloudflareTaskStore() {
  const resource = getRequestResource<
    ReturnType<typeof createCloudflareTaskStore>
  >(TASK_STORAGE_RESOURCE);
  if (resource) return resource;
  if (process.env.TASK_STORAGE_BACKEND === 'cloudflare')
    throw new Error('Cloudflare task storage binding unavailable');
  if (
    process.env.TASK_STORAGE_BACKEND &&
    process.env.TASK_STORAGE_BACKEND !== 'redis'
  )
    throw new Error('Unsupported task storage backend');
  return undefined;
}
