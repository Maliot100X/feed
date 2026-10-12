import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ExternalAgentConnectionParams } from '@feed/agents';
import { NextRequest } from 'next/server';

const mockAuthenticate = mock();
const mockCheckRateLimit = mock();
const mockRegister = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticate: mockAuthenticate,
  checkRateLimitAsync: mockCheckRateLimit,
}));

const actualAgents = await import('@feed/agents');
mock.module('@feed/agents', () => ({
  ...actualAgents,
  agentRegistry: { registerExternalAgent: mockRegister },
}));

const { POST } = await import('../route');

const validBody = {
  externalId: 'ext-1',
  name: 'External',
  description: 'An external agent',
  endpoint: 'https://agent.example.com/a2a',
  protocol: 'a2a',
  capabilities: {},
};

function post(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/agents/external/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agents/external/register', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockCheckRateLimit.mockReset();
    mockRegister.mockReset();
    mockAuthenticate.mockResolvedValue({ userId: 'user-1' });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockRegister.mockImplementation(
      async (params: ExternalAgentConnectionParams) => ({
        agentId: `external-${params.externalId}`,
        name: params.name,
        status: 'REGISTERED',
        trustLevel: 0,
        capabilities: params.capabilities,
      })
    );
  });

  it('stores only the hash of the issued key', async () => {
    const response = await POST(post(validBody));
    const body = await response.json();

    expect(response.status).toBe(201);
    const params = mockRegister.mock
      .calls[0]?.[0] as ExternalAgentConnectionParams;
    expect(JSON.parse(params.authentication?.credentials ?? '{}')).toEqual({
      apiKeyHash: actualApi.hashApiKey(body.apiKey),
    });
  });

  it('rejects caller-supplied credentials that could override apiKeyHash', async () => {
    const response = await POST(
      post({
        ...validBody,
        authentication: {
          type: 'API_KEY',
          credentials: { apiKeyHash: 'attacker-controlled-hash' },
        },
      })
    );

    expect(response.status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
