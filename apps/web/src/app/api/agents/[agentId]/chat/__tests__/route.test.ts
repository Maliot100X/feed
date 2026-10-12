import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticateUser: mockAuthenticateUser,
}));

const { POST } = await import('../route');

const context = { params: Promise.resolve({ agentId: 'agent-1' }) };

function post(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/agents/agent-1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agents/[agentId]/chat body validation', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateUser.mockResolvedValue({ id: 'owner-1' });
  });

  for (const [label, body] of [
    ['string usePro', { message: 'hi', usePro: 'false' }],
    ['missing message', { usePro: false }],
    ['non-string message', { message: 42 }],
    ['null body', null],
  ] as const) {
    it(`rejects ${label} with 400 before any work`, async () => {
      const response = await POST(post(body), context);
      expect(response.status).toBe(400);
      expect(mockAuthenticateUser).not.toHaveBeenCalled();
    });
  }
});
