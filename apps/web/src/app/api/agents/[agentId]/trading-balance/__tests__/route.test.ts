import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();
const mockDeposit = mock();
const mockWithdraw = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticateUser: mockAuthenticateUser,
}));

const actualAgents = await import('@feed/agents');
mock.module('@feed/agents', () => ({
  ...actualAgents,
  agentService: {
    depositTradingBalance: mockDeposit,
    withdrawTradingBalance: mockWithdraw,
  },
}));

const { POST } = await import('../route');

const context = { params: Promise.resolve({ agentId: 'agent-1' }) };

function post(body: unknown): NextRequest {
  return new NextRequest(
    'https://example.com/api/agents/agent-1/trading-balance',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/agents/[agentId]/trading-balance validation', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockDeposit.mockReset();
    mockWithdraw.mockReset();
    mockAuthenticateUser.mockResolvedValue({ id: 'owner-1' });
  });

  const invalid: Array<[string, unknown]> = [
    ['numeric string amount', { action: 'deposit', amount: '10' }],
    ['object amount', { action: 'deposit', amount: { n: 1 } }],
    ['negative amount', { action: 'withdraw', amount: -5 }],
    ['zero amount', { action: 'withdraw', amount: 0 }],
    ['unknown action', { action: 'transfer', amount: 5 }],
    ['missing action', { amount: 5 }],
    ['null body', null],
  ];

  for (const [name, body] of invalid) {
    it(`rejects ${name} with zero writes`, async () => {
      const response = await POST(post(body), context);
      expect(response.status).toBe(400);
      expect(mockDeposit).not.toHaveBeenCalled();
      expect(mockWithdraw).not.toHaveBeenCalled();
    });
  }
});
