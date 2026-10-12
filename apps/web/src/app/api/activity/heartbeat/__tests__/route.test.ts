import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockOptionalAuth = mock();
const actualApi = await import('@feed/api');

mock.module('@feed/api', () => ({
  ...actualApi,
  optionalAuth: mockOptionalAuth,
}));

const { POST } = await import('../route');

function heartbeat(body: string): NextRequest {
  return new NextRequest('https://example.com/api/activity/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/activity/heartbeat validation', () => {
  beforeEach(() => {
    mockOptionalAuth.mockReset();
    mockOptionalAuth.mockResolvedValue(null);
  });

  it('rejects a null JSON body with 400 instead of throwing', async () => {
    const response = await POST(heartbeat('null'));
    expect(response.status).toBe(400);
    expect(mockOptionalAuth).not.toHaveBeenCalled();
  });

  it('rejects a non-string lastPath with 400', async () => {
    const response = await POST(
      heartbeat(JSON.stringify({ sessionId: 's-1', lastPath: 42 }))
    );
    expect(response.status).toBe(400);
  });

  it('rejects non-numeric pageViews with 400', async () => {
    const response = await POST(
      heartbeat(JSON.stringify({ sessionId: 's-1', pageViews: '5' }))
    );
    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await POST(heartbeat('not json {{'));
    expect(response.status).toBe(400);
  });

  it('accepts a valid body from an unauthenticated caller without writing', async () => {
    const response = await POST(
      heartbeat(JSON.stringify({ sessionId: 's-1', pageViews: 3 }))
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      reason: 'unauthenticated',
    });
  });
});
