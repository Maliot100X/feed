import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticateUser: mockAuthenticateUser,
  checkRateLimitAndDuplicates: () => null,
}));

const { POST } = await import('../route');

function post(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/agents/generate-field', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agents/generate-field input validation', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateUser.mockResolvedValue({ userId: 'user-1' });
  });

  for (const [name, body] of [
    ['missing fieldName', {}],
    ['unknown fieldName', { fieldName: 'walletAddress' }],
    ['non-object context', { fieldName: 'name', context: 'x' }],
    ['non-string currentValue', { fieldName: 'system', currentValue: 5 }],
    ['null body', null],
  ] as const) {
    it(`rejects ${name} with 400 before any provider call`, async () => {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
    });
  }
});
