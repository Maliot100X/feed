import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();
const mockGetTeamChat = mock();
const mockValidateOwnership = mock();
const mockGetTeamChatAgents = mock();
const mockInsertValues = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticateUser: mockAuthenticateUser,
  checkRateLimitAsync: async () => ({ allowed: true }),
}));

const actualAgents = await import('@feed/agents');
mock.module('@feed/agents', () => ({
  ...actualAgents,
  teamChatService: {
    getTeamChat: mockGetTeamChat,
    validateTeamChatOwnership: mockValidateOwnership,
    getTeamChatAgents: mockGetTeamChatAgents,
  },
}));

const actualDb = await import('@feed/db');
mock.module('@feed/db', () => ({
  ...actualDb,
  db: { insert: () => ({ values: mockInsertValues }) },
}));

const { POST } = await import('../route');

function post(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/agents/team-chat/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agents/team-chat/message targeting', () => {
  beforeEach(() => {
    for (const fn of [
      mockAuthenticateUser,
      mockGetTeamChat,
      mockValidateOwnership,
      mockGetTeamChatAgents,
      mockInsertValues,
    ]) {
      fn.mockReset();
    }
    mockAuthenticateUser.mockResolvedValue({ id: 'owner-1' });
    mockGetTeamChat.mockResolvedValue({ chatId: 'active-chat', groupId: 'g1' });
    mockGetTeamChatAgents.mockResolvedValue([{ id: 'agent-1' }]);
  });

  it('rejects whitespace-only content', async () => {
    const response = await POST(post({ content: '   ' }));
    expect(response.status).toBe(400);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it('rejects an explicit chatId the user does not own', async () => {
    mockValidateOwnership.mockResolvedValue(false);

    const response = await POST(post({ content: 'hi', chatId: 'other-chat' }));

    expect(response.status).toBe(404);
    expect(mockValidateOwnership).toHaveBeenCalledWith('owner-1', 'other-chat');
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it('rejects targetIds that are not agents in the team chat', async () => {
    const response = await POST(
      post({ content: 'hi', targetIds: ['agent-1', 'someone-else'] })
    );

    expect(response.status).toBe(400);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
