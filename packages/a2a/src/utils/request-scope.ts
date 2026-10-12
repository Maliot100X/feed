/**
 * A2A request scoping and task authorization.
 *
 * The executor acts as the request's contextId, so every transport must:
 * 1. bind contextId to the authenticated user for per-user API keys, and
 * 2. only expose tasks owned by that user (tasks are addressed by ID, which
 *    is not a secret).
 *
 * Server API keys and the non-production localhost bypass are trusted
 * operators and may act on any context.
 */

import type { Task } from '@a2a-js/sdk';
import type { AuthResult } from './api-key-auth';

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ScopedJsonRpcBody {
  method?: unknown;
  params?: unknown;
}

export type ScopeResult =
  | { ok: true; userId?: string }
  | { ok: false; message: string };

/**
 * Bind the request to the caller. For per-user API keys, contextId (both
 * params.contextId and params.message.contextId) is overwritten with the
 * authenticated user ID. Mutates `body.params`.
 */
export function scopeRequestToCaller(
  body: ScopedJsonRpcBody,
  authResult: AuthResult
): ScopeResult {
  if (authResult.authMethod !== 'user-key') {
    return { ok: true };
  }

  const userId = authResult.userId;
  if (!userId) {
    return {
      ok: false,
      message: 'Authentication error: Invalid user identity',
    };
  }

  if (!isPlainObject(body.params)) {
    body.params = {};
  }
  const params = body.params as JsonObject;
  if (isPlainObject(params.message)) {
    params.message.contextId = userId;
  }
  params.contextId = userId;
  return { ok: true, userId };
}

const TASK_ID_METHODS = new Set([
  'tasks/get',
  'tasks/cancel',
  'tasks/resubscribe',
  'tasks/pushNotificationConfig/set',
  'tasks/pushNotificationConfig/get',
  'tasks/pushNotificationConfig/list',
  'tasks/pushNotificationConfig/delete',
]);

/**
 * The task a request addresses, if any: params.id / params.taskId for task
 * methods, params.message.taskId when continuing a task via message/send.
 */
export function getReferencedTaskId(
  body: ScopedJsonRpcBody
): string | undefined {
  if (typeof body.method !== 'string' || !isPlainObject(body.params)) {
    return undefined;
  }
  const params = body.params;
  if (TASK_ID_METHODS.has(body.method)) {
    const id = params.id ?? params.taskId;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }
  if (
    (body.method === 'message/send' || body.method === 'message/stream') &&
    isPlainObject(params.message) &&
    typeof params.message.taskId === 'string' &&
    params.message.taskId.length > 0
  ) {
    return params.message.taskId;
  }
  return undefined;
}

/**
 * Whether the caller may see or act on the task.
 */
export function canAccessTask(task: Task, authResult: AuthResult): boolean {
  if (authResult.authMethod === 'user-key') {
    return !!authResult.userId && task.contextId === authResult.userId;
  }
  return (
    authResult.authMethod === 'server-key' ||
    authResult.authMethod === 'localhost'
  );
}

export interface TaskLoader {
  load(taskId: string): Promise<Task | undefined>;
}

/**
 * Reject requests that reference a task the caller cannot access. Tasks that
 * do not exist are left for the protocol handler to report. A task owned by
 * someone else is reported as not found so task IDs cannot be probed.
 */
export async function authorizeTaskReference(
  body: ScopedJsonRpcBody,
  authResult: AuthResult,
  taskStore: TaskLoader
): Promise<{ ok: true } | { ok: false; taskId: string }> {
  const taskId = getReferencedTaskId(body);
  if (!taskId) return { ok: true };
  const task = await taskStore.load(taskId);
  if (!task || canAccessTask(task, authResult)) return { ok: true };
  return { ok: false, taskId };
}
