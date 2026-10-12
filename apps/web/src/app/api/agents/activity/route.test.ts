import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();
const mockGetAgentActivity = mock();
const mockWhere = mock();

const actualDb = await import('@feed/db');
mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    select: () => ({ from: () => ({ where: mockWhere }) }),
  },
}));

mock.module('@feed/api', () => ({
  authenticateUser: mockAuthenticateUser,
  withErrorHandling: <T>(handler: T) => handler,
}));

const actualActivity = await import('@/lib/agents/agent-activity');
mock.module('@/lib/agents/agent-activity', () => ({
  ...actualActivity,
  getAgentActivity: mockGetAgentActivity,
}));

const { GET } = await import('./route');

function request(query = ''): NextRequest {
  return {
    url: `https://example.com/api/agents/activity${query}`,
  } as NextRequest;
}

describe('GET /api/agents/activity', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockGetAgentActivity.mockReset();
    mockWhere.mockReset();
    mockAuthenticateUser.mockResolvedValue({ id: 'owner-1' });
    mockWhere.mockResolvedValue([
      { id: 'agent-1', displayName: 'Alpha', profileImageUrl: null },
      { id: 'agent-2', displayName: null, profileImageUrl: 'img.png' },
    ]);
    mockGetAgentActivity.mockResolvedValue({ activities: [], hasMore: false });
  });

  it('applies defaults when no query params are present', async () => {
    const response = (await GET(request())) as Response;

    expect(response.status).toBe(200);
    expect(mockGetAgentActivity).toHaveBeenCalledWith({
      agentIds: ['agent-1', 'agent-2'],
      limit: 50,
      type: 'all',
    });
  });

  it('attaches owning agent info to each activity across mixed agents', async () => {
    mockGetAgentActivity.mockResolvedValue({
      activities: [
        {
          type: 'post',
          id: 'p2',
          agentId: 'agent-2',
          timestamp: '2026-01-02T00:00:00.000Z',
          data: { postId: 'p2', contentPreview: 'b' },
        },
        {
          type: 'post',
          id: 'p1',
          agentId: 'agent-1',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { postId: 'p1', contentPreview: 'a' },
        },
      ],
      hasMore: false,
    });

    const body = await ((await GET(request('?type=post'))) as Response).json();

    expect(
      body.activities.map((a: { agent: { name: string } }) => a.agent.name)
    ).toEqual(['Agent', 'Alpha']);
    expect(body.pagination).toEqual({ limit: 50, count: 2, hasMore: false });
  });

  it('returns an empty page when the user owns no agents', async () => {
    mockWhere.mockResolvedValue([]);

    const body = await ((await GET(request())) as Response).json();

    expect(mockGetAgentActivity).toHaveBeenCalledWith({
      agentIds: [],
      limit: 50,
      type: 'all',
    });
    expect(body.activities).toEqual([]);
  });
});
