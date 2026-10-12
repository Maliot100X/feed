import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticateUser = mock();
const mockGetCached = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticateUser: mockAuthenticateUser,
  getCachedAgentAvatarUrl: mockGetCached,
}));

const { POST } = await import('../route');

function post(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://example.com/api/agents/generate-avatar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('POST /api/agents/generate-avatar input validation', () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockGetCached.mockReset();
    mockAuthenticateUser.mockResolvedValue({ userId: 'user-1' });
    mockGetCached.mockResolvedValue('https://cdn.example.com/cached.png');
  });

  it('rejects a null idempotencyKey with 400 instead of crashing', async () => {
    const response = await POST(post(JSON.stringify({ idempotencyKey: null })));
    expect(response.status).toBe(400);
    expect(mockGetCached).not.toHaveBeenCalled();
  });

  it('rejects a non-string idempotencyKey with 400', async () => {
    const response = await POST(
      post(JSON.stringify({ idempotencyKey: 12345678 }))
    );
    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await POST(
      post('{not json', { 'Idempotency-Key': 'key-12345678' })
    );
    expect(response.status).toBe(400);
    expect(mockGetCached).not.toHaveBeenCalled();
  });

  it('rejects conflicting header and body keys', async () => {
    const response = await POST(
      post(JSON.stringify({ idempotencyKey: 'body-key-123' }), {
        'Idempotency-Key': 'header-key-123',
      })
    );
    expect(response.status).toBe(400);
    expect(mockGetCached).not.toHaveBeenCalled();
  });

  it('serves a cached result for a valid key', async () => {
    const response = await POST(
      post(
        JSON.stringify({ idempotencyKey: 'same-key-123', displayName: 'A' }),
        {
          'Idempotency-Key': 'same-key-123',
        }
      )
    );
    expect(response.status).toBe(200);
    expect(mockGetCached).toHaveBeenCalledWith('user-1', 'same-key-123');
  });
});
