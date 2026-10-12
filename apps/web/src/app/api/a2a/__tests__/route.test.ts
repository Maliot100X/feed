import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Task } from '@a2a-js/sdk';
import { NextRequest } from 'next/server';

const mockCheckApiKey = mock();
const tasks = new Map<string, Task>();

class FakeTaskStore {
  async load(taskId: string): Promise<Task | undefined> {
    return tasks.get(taskId);
  }
  async save(task: Task): Promise<void> {
    tasks.set(task.id, task);
  }
}

const actualA2a = await import('@feed/a2a');
mock.module('@feed/a2a', () => ({
  ...actualA2a,
  PersistentTaskStore: FakeTaskStore,
}));

mock.module('@/lib/api/check-api-key', () => ({
  checkApiKey: mockCheckApiKey,
}));

const { POST } = await import('../route');

function rpc(body: string): NextRequest {
  return new NextRequest('https://example.com/api/a2a', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/a2a envelope and task ownership', () => {
  beforeEach(() => {
    tasks.clear();
    mockCheckApiKey.mockReset();
    mockCheckApiKey.mockResolvedValue({
      authResult: {
        authenticated: true,
        authMethod: 'user-key',
        userId: 'user-b',
      },
    });
  });

  for (const raw of ['null', '42', '[]', '"x"']) {
    it(`returns JSON-RPC invalid request for body ${raw}`, async () => {
      const response = await POST(rpc(raw));
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.error.code).toBe(-32600);
    });
  }

  it('rejects non-object params instead of replacing them', async () => {
    const response = await POST(
      rpc(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tasks/get',
          params: 'x',
        })
      )
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32602);
  });

  it("hides another user's task", async () => {
    tasks.set('task-a', {
      kind: 'task',
      id: 'task-a',
      contextId: 'user-a',
      status: { state: 'completed' },
    });

    const response = await POST(
      rpc(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tasks/get',
          params: { id: 'task-a' },
        })
      )
    );
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error.code).toBe(-32001);
  });

  it('lets the owner read their task', async () => {
    tasks.set('task-b', {
      kind: 'task',
      id: 'task-b',
      contextId: 'user-b',
      status: { state: 'completed' },
    });

    const response = await POST(
      rpc(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tasks/get',
          params: { id: 'task-b' },
        })
      )
    );
    const body = await response.json();
    expect(body.result.id).toBe('task-b');
  });
});
