import { describe, expect, it } from 'bun:test';
import type { Task } from '@a2a-js/sdk';
import {
  authorizeTaskReference,
  canAccessTask,
  getReferencedTaskId,
  scopeRequestToCaller,
} from '../../../a2a/src/utils/request-scope';

const task = (id: string, contextId: string): Task => ({
  kind: 'task',
  id,
  contextId,
  status: { state: 'completed', timestamp: new Date().toISOString() },
});

const userA = {
  authenticated: true,
  authMethod: 'user-key',
  userId: 'a',
} as const;
const serverKey = { authenticated: true, authMethod: 'server-key' } as const;

describe('A2A request scoping', () => {
  it('binds both contextId locations to the authenticated user', () => {
    const body = {
      method: 'message/send',
      params: { contextId: 'victim', message: { contextId: 'victim' } },
    };
    expect(scopeRequestToCaller(body, userA)).toEqual({
      ok: true,
      userId: 'a',
    });
    expect(body.params.contextId).toBe('a');
    expect(body.params.message.contextId).toBe('a');
  });

  it('adds a contextId when params are missing', () => {
    const body: { method: string; params?: unknown } = { method: 'tasks/list' };
    scopeRequestToCaller(body, userA);
    expect(body.params).toEqual({ contextId: 'a' });
  });

  it('rejects a user key without a user id', () => {
    const result = scopeRequestToCaller(
      { method: 'tasks/list' },
      { authenticated: true, authMethod: 'user-key' }
    );
    expect(result.ok).toBe(false);
  });

  it('leaves server-key requests untouched', () => {
    const body = { method: 'tasks/list', params: { contextId: 'x' } };
    scopeRequestToCaller(body, serverKey);
    expect(body.params.contextId).toBe('x');
  });

  it('extracts referenced task ids', () => {
    expect(
      getReferencedTaskId({ method: 'tasks/get', params: { id: 't1' } })
    ).toBe('t1');
    expect(
      getReferencedTaskId({ method: 'tasks/cancel', params: { taskId: 't2' } })
    ).toBe('t2');
    expect(
      getReferencedTaskId({
        method: 'message/send',
        params: { message: { taskId: 't3' } },
      })
    ).toBe('t3');
    expect(
      getReferencedTaskId({ method: 'tasks/list', params: {} })
    ).toBeUndefined();
  });

  it('only lets user keys access their own tasks', () => {
    expect(canAccessTask(task('t', 'a'), userA)).toBe(true);
    expect(canAccessTask(task('t', 'b'), userA)).toBe(false);
    expect(canAccessTask(task('t', 'b'), serverKey)).toBe(true);
  });

  it('rejects cross-user task references and allows unknown/own tasks', async () => {
    const store = {
      load: async (id: string) =>
        id === 'own'
          ? task('own', 'a')
          : id === 'other'
            ? task('other', 'b')
            : undefined,
    };
    expect(
      await authorizeTaskReference(
        { method: 'tasks/get', params: { id: 'other' } },
        userA,
        store
      )
    ).toEqual({ ok: false, taskId: 'other' });
    expect(
      await authorizeTaskReference(
        { method: 'tasks/get', params: { id: 'own' } },
        userA,
        store
      )
    ).toEqual({ ok: true });
    expect(
      await authorizeTaskReference(
        { method: 'tasks/get', params: { id: 'missing' } },
        userA,
        store
      )
    ).toEqual({ ok: true });
    expect(
      await authorizeTaskReference(
        { method: 'message/send', params: { message: { taskId: 'other' } } },
        userA,
        store
      )
    ).toEqual({ ok: false, taskId: 'other' });
  });
});
