import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const mockAuthenticate = mock();
const mockLimit = mock();

const actualApi = await import('@feed/api');
mock.module('@feed/api', () => ({
  ...actualApi,
  authenticate: mockAuthenticate,
}));

const actualDb = await import('@feed/db');
mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }),
  },
}));

const { GET } = await import('../route');

describe('GET /api/agents/onboard', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockLimit.mockReset();
    mockAuthenticate.mockResolvedValue({ userId: 'agent-x', isAgent: true });
  });

  it('reports isRegistered=false when no local user exists', async () => {
    mockLimit.mockResolvedValue([]);

    const response = await GET(
      new NextRequest('https://example.com/api/agents/onboard')
    );
    const body = await response.json();

    expect(body.isRegistered).toBe(false);
    expect(body.userId).toBeNull();
  });

  it('reports isRegistered=true with the local user id', async () => {
    mockLimit.mockResolvedValue([{ id: 'user-123' }]);

    const response = await GET(
      new NextRequest('https://example.com/api/agents/onboard')
    );
    const body = await response.json();

    expect(body.isRegistered).toBe(true);
    expect(body.userId).toBe('user-123');
  });
});
