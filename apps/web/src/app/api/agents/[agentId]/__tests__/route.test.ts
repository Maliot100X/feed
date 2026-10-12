import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();
const mockGetAgent = mock();
const mockGetPerformance = mock();
const mockUpdateAgent = mock();
const mockGetAgentConfig = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticateUser: mockAuthenticateUser,
}));

const actualAgents = await import('@feed/agents');
mock.module('@feed/agents', () => ({
  ...actualAgents,
  agentService: {
    getAgent: mockGetAgent,
    getPerformance: mockGetPerformance,
    updateAgent: mockUpdateAgent,
  },
  getAgentConfig: mockGetAgentConfig,
}));

const { GET, PUT } = await import('../route');

const context = { params: Promise.resolve({ agentId: 'agent-1' }) };
const now = new Date('2026-01-01T00:00:00.000Z');

const agentRow = {
  id: 'agent-1',
  username: 'alpha',
  displayName: 'Alpha',
  bio: 'line one\nline two',
  profileImageUrl: null,
  coverImageUrl: null,
  virtualBalance: '10',
  totalDeposited: null,
  totalWithdrawn: null,
  lifetimePnL: '0',
  walletAddress: null,
  createdAt: now,
  updatedAt: now,
};

function put(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/agents/agent-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/agents/[agentId]', () => {
  beforeEach(() => {
    for (const fn of [
      mockAuthenticateUser,
      mockGetAgent,
      mockGetPerformance,
      mockUpdateAgent,
      mockGetAgentConfig,
    ]) {
      fn.mockReset();
    }
    mockAuthenticateUser.mockResolvedValue({ id: 'owner-1' });
    mockGetPerformance.mockResolvedValue({
      totalTrades: 0,
      profitableTrades: 0,
      winRate: 0,
    });
    mockGetAgentConfig.mockResolvedValue(null);
    mockUpdateAgent.mockResolvedValue(agentRow);
  });

  it('GET returns 404 for a missing agent without loading performance', async () => {
    mockGetAgent.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('https://example.com/api/agents/agent-1'),
      context
    );

    expect(response.status).toBe(404);
    expect(mockGetAgent).toHaveBeenCalledWith('agent-1', 'owner-1');
    expect(mockGetPerformance).not.toHaveBeenCalled();
  });

  it('GET tolerates non-string messageExamples entries', async () => {
    mockGetAgent.mockResolvedValue(agentRow);
    mockGetAgentConfig.mockResolvedValue({
      messageExamples: [{ user: 'x', content: 'y' }, ' ', 'kept'],
    });

    const response = await GET(
      new NextRequest('https://example.com/api/agents/agent-1'),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent.bio).toEqual(['kept']);
    expect(body.agent.personality).toBe('kept');
  });

  it('PUT rejects wrong field types without updating', async () => {
    const response = await PUT(put({ autonomousPosting: 'false' }), context);

    expect(response.status).toBe(400);
    expect(mockUpdateAgent).not.toHaveBeenCalled();
  });

  it('PUT rejects a null bio instead of silently clearing it', async () => {
    const response = await PUT(put({ bio: null }), context);

    expect(response.status).toBe(400);
    expect(mockUpdateAgent).not.toHaveBeenCalled();
  });

  it('PUT accepts the documented autonomousTrading field', async () => {
    const response = await PUT(
      put({ autonomousTrading: true, bio: 'a\nb' }),
      context
    );

    expect(response.status).toBe(200);
    expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', 'owner-1', {
      autonomousTrading: true,
      bio: ['a', 'b'],
    });
  });
});
