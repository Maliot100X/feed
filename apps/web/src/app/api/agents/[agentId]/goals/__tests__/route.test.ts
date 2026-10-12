import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticate = mock();
const mockFindAgent = mock();
const mockCreateGoal = mock();
const mockFindGoal = mock();
const mockUpdateGoal = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticate: mockAuthenticate,
}));

const actualDb = await import('@feed/db');
mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    user: { findUnique: mockFindAgent },
    agentGoal: {
      create: mockCreateGoal,
      findUnique: mockFindGoal,
      update: mockUpdateGoal,
    },
  },
}));

const { POST } = await import('../route');
const { PUT } = await import('../[goalId]/route');

function request(method: string, body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/agents/agent-1/goals', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const agentContext = { params: Promise.resolve({ agentId: 'agent-1' }) };
const goalContext = {
  params: Promise.resolve({ agentId: 'agent-1', goalId: 'goal-1' }),
};

describe('agent goal routes', () => {
  beforeEach(() => {
    for (const fn of [
      mockAuthenticate,
      mockFindAgent,
      mockCreateGoal,
      mockFindGoal,
      mockUpdateGoal,
    ]) {
      fn.mockReset();
    }
    mockAuthenticate.mockResolvedValue({ userId: 'owner-1' });
    mockFindAgent.mockResolvedValue({ isAgent: true, managedBy: 'owner-1' });
    mockFindGoal.mockResolvedValue({
      id: 'goal-1',
      agentUserId: 'agent-1',
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockUpdateGoal.mockImplementation(async ({ data }) => ({
      id: 'goal-1',
      target: null,
      ...data,
    }));
  });

  for (const [label, body] of [
    [
      'string priority',
      { type: 'trading', name: 'n', description: 'd', priority: '9' },
    ],
    [
      'fractional priority',
      { type: 'trading', name: 'n', description: 'd', priority: 2.5 },
    ],
    ['blank name', { type: 'trading', name: '   ', description: 'd' }],
    [
      'non-string target',
      { type: 'trading', name: 'n', description: 'd', target: { x: 1 } },
    ],
  ] as const) {
    it(`POST rejects ${label}`, async () => {
      const response = await POST(request('POST', body), agentContext);
      expect(response.status).toBe(400);
      expect(mockCreateGoal).not.toHaveBeenCalled();
    });
  }

  it('PUT rejects an empty or malformed update', async () => {
    for (const body of [{}, { priority: 'high' }, { bogus: true }]) {
      const response = await PUT(request('PUT', body), goalContext);
      expect(response.status).toBe(400);
    }
    expect(mockUpdateGoal).not.toHaveBeenCalled();
  });

  it('PUT clears completedAt when a completed goal is reactivated', async () => {
    const response = await PUT(
      request('PUT', { status: 'active' }),
      goalContext
    );

    expect(response.status).toBe(200);
    expect(mockUpdateGoal.mock.calls[0]?.[0].data).toMatchObject({
      status: 'active',
      completedAt: null,
    });
  });

  it('PUT can clear the target with null', async () => {
    await PUT(request('PUT', { target: null }), goalContext);
    expect(mockUpdateGoal.mock.calls[0]?.[0].data).toMatchObject({
      target: null,
    });
  });
});
