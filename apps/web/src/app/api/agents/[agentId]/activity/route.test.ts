import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();
const mockGetAgent = mock();
const mockGetAgentActivity = mock();

mock.module('@feed/api', () => ({
  authenticateUser: mockAuthenticateUser,
  withErrorHandling: <T>(handler: T) => handler,
}));

mock.module('@feed/agents', () => ({
  agentService: { getAgent: mockGetAgent },
}));

const actualActivity = await import('@/lib/agents/agent-activity');
mock.module('@/lib/agents/agent-activity', () => ({
  ...actualActivity,
  getAgentActivity: mockGetAgentActivity,
}));

const { GET } = await import('./route');

function request(query = ''): NextRequest {
  return {
    url: `https://example.com/api/agents/agent-1/activity${query}`,
  } as NextRequest;
}

const context = { params: Promise.resolve({ agentId: 'agent-1' }) };

describe('GET /api/agents/[agentId]/activity', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockGetAgent.mockReset();
    mockGetAgentActivity.mockReset();
    mockAuthenticateUser.mockResolvedValue({ id: 'owner-1' });
    mockGetAgent.mockResolvedValue({ id: 'agent-1', displayName: 'Alpha' });
    mockGetAgentActivity.mockResolvedValue({ activities: [], hasMore: false });
  });

  it('applies defaults when no query params are present', async () => {
    const response = (await GET(request(), context)) as Response;

    expect(response.status).toBe(200);
    expect(mockGetAgentActivity).toHaveBeenCalledWith({
      agentIds: ['agent-1'],
      limit: 50,
      type: 'all',
    });
  });

  it('applies the default for each omitted field independently', async () => {
    await GET(request('?type=post'), context);
    expect(mockGetAgentActivity).toHaveBeenLastCalledWith({
      agentIds: ['agent-1'],
      limit: 50,
      type: 'post',
    });

    await GET(request('?limit=5'), context);
    expect(mockGetAgentActivity).toHaveBeenLastCalledWith({
      agentIds: ['agent-1'],
      limit: 5,
      type: 'all',
    });
  });

  it('checks ownership with the authenticated user and 404s without querying', async () => {
    mockGetAgent.mockResolvedValue(null);

    const response = (await GET(request(), context)) as Response;

    expect(response.status).toBe(404);
    expect(mockGetAgent).toHaveBeenCalledWith('agent-1', 'owner-1');
    expect(mockGetAgentActivity).not.toHaveBeenCalled();
  });

  it('returns the service page and exact hasMore', async () => {
    mockGetAgentActivity.mockResolvedValue({
      activities: [
        {
          type: 'post',
          id: 'p1',
          agentId: 'agent-1',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { postId: 'p1', contentPreview: 'hi' },
        },
      ],
      hasMore: true,
    });

    const response = (await GET(request('?limit=1'), context)) as Response;
    const body = await response.json();

    expect(body.agentName).toBe('Alpha');
    expect(body.activities).toHaveLength(1);
    expect(body.pagination).toEqual({ limit: 1, count: 1, hasMore: true });
  });

  it('rejects an out-of-range limit', async () => {
    await expect(GET(request('?limit=0'), context)).rejects.toThrow();
    expect(mockGetAgentActivity).not.toHaveBeenCalled();
  });
});
