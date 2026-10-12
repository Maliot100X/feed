import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();
const mockLimit = mock();
const mockTransaction = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticateUser: mockAuthenticateUser,
}));

const actualDb = await import('@feed/db');
const where = () => ({ limit: mockLimit });
mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    select: () => ({
      from: () => ({ where, innerJoin: () => ({ where }) }),
    }),
    transaction: mockTransaction,
  },
}));

const { POST, DELETE } = await import('../route');

const context = { params: Promise.resolve({ agentId: 'agent-1' }) };

function request(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(
    `https://example.com/api/agents/agent-1/alerts${query}`,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

describe('/api/agents/[agentId]/alerts validation', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockLimit.mockReset();
    mockTransaction.mockReset();
    mockAuthenticateUser.mockResolvedValue({ id: 'owner-1' });
    // Ownership lookup, then config lookup.
    mockLimit
      .mockResolvedValueOnce([
        { id: 'agent-1', isAgent: true, managedBy: 'owner-1' },
      ])
      .mockResolvedValueOnce([{ id: 'cfg-1', priceAlerts: [] }]);
  });

  it('rejects a group target the agent is not a member of, without writing', async () => {
    mockLimit.mockResolvedValueOnce([]); // membership check

    const response = await POST(
      request('POST', {
        tokenSymbol: 'btc',
        condition: 'above',
        threshold: 100,
        deliveryChannel: 'group',
        deliveryChatId: 'someone-elses-chat',
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a deliveryChatId without the group channel', async () => {
    const response = await POST(
      request('POST', {
        tokenSymbol: 'btc',
        condition: 'above',
        threshold: 100,
        deliveryChatId: 'chat-1',
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects DELETE with both selectors or an invalid condition', async () => {
    for (const query of [
      '?alertId=a1&tokenSymbol=BTC',
      '?tokenSymbol=BTC&condition=sideways',
    ]) {
      mockLimit
        .mockResolvedValueOnce([
          { id: 'agent-1', isAgent: true, managedBy: 'owner-1' },
        ])
        .mockResolvedValueOnce([{ id: 'cfg-1', priceAlerts: [] }]);
      const response = await DELETE(
        request('DELETE', undefined, query),
        context
      );
      expect(response.status).toBe(400);
    }
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
