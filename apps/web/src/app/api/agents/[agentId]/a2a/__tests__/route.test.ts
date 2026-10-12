import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Task } from '@a2a-js/sdk';
import type { AuthResult } from '@feed/a2a';
import { NextRequest, NextResponse } from 'next/server';

const mockCheckApiKey = mock();
const mockGetAgentConfig = mock();
const mockAgentRows = mock();
const tasks = new Map<string, Task>();
const listCalls: Array<Record<string, unknown>> = [];

class FakeTaskStore {
  async load(taskId: string): Promise<Task | undefined> {
    return tasks.get(taskId);
  }
  async save(task: Task): Promise<void> {
    tasks.set(task.id, task);
  }
  async list(params: Record<string, unknown>) {
    listCalls.push(params);
    return { tasks: [], nextPageToken: undefined };
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

const actualAgents = await import('@feed/agents');
mock.module('@feed/agents', () => ({
  ...actualAgents,
  getAgentConfig: mockGetAgentConfig,
}));

const actualDb = await import('@feed/db');
mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: mockAgentRows }) }),
    }),
  },
}));

const { POST } = await import('../route');

const context = { params: Promise.resolve({ agentId: 'agent-1' }) };

function rpc(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://example.com/api/agents/agent-1/a2a', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function authAs(result: AuthResult): void {
  mockCheckApiKey.mockResolvedValue({ authResult: result });
}

function task(id: string, contextId: string): Task {
  return {
    kind: 'task',
    id,
    contextId,
    status: { state: 'working', timestamp: '2026-01-01T00:00:00.000Z' },
  };
}

describe('POST /api/agents/[agentId]/a2a', () => {
  beforeEach(() => {
    tasks.clear();
    listCalls.length = 0;
    mockCheckApiKey.mockReset();
    mockGetAgentConfig.mockReset();
    mockAgentRows.mockReset();
    mockAgentRows.mockResolvedValue([
      {
        id: 'agent-1',
        isAgent: true,
        isBanned: false,
        displayName: 'Agent One',
        bio: null,
        profileImageUrl: null,
      },
    ]);
    mockGetAgentConfig.mockResolvedValue({
      a2aEnabled: true,
      systemPrompt: 'SECRET PROMPT',
    });
  });

  it('rejects callers without an API key, ignoring spoofed x-agent-id', async () => {
    mockCheckApiKey.mockResolvedValue({
      error: NextResponse.json({ error: 'API key required' }, { status: 401 }),
    });

    const response = await POST(
      rpc(
        { jsonrpc: '2.0', id: 1, method: 'tasks/list', params: {} },
        { 'x-agent-id': 'someone-else' }
      ),
      context
    );

    expect(response.status).toBe(401);
    expect(listCalls).toHaveLength(0);
  });

  it('returns a JSON-RPC invalid request for a null body', async () => {
    authAs({ authenticated: true, authMethod: 'user-key', userId: 'user-a' });

    const response = await POST(rpc('null'), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(-32600);
  });

  it("hides another user's task from tasks/get", async () => {
    authAs({ authenticated: true, authMethod: 'user-key', userId: 'user-b' });
    tasks.set('task-a', task('task-a', 'user-a'));

    const response = await POST(
      rpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tasks/get',
        params: { taskId: 'task-a' },
      }),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe(-32001);
    expect(JSON.stringify(body)).not.toContain('user-a');
  });

  it("refuses to cancel another user's task", async () => {
    authAs({ authenticated: true, authMethod: 'user-key', userId: 'user-b' });
    tasks.set('task-a', task('task-a', 'user-a'));

    const response = await POST(
      rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tasks/cancel',
        params: { id: 'task-a' },
      }),
      context
    );

    expect(response.status).toBe(404);
    expect(tasks.get('task-a')?.status.state).toBe('working');
  });

  it('scopes tasks/list to the authenticated user regardless of requested contextId', async () => {
    authAs({ authenticated: true, authMethod: 'user-key', userId: 'user-a' });

    const response = await POST(
      rpc({
        jsonrpc: '2.0',
        id: 5,
        method: 'tasks/list',
        params: { contextId: 'user-b', status: 'running' },
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(listCalls[0]).toMatchObject({
      contextId: 'user-a',
      status: 'working',
    });
  });
});
