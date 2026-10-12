import { beforeEach, describe, expect, it, mock } from 'bun:test';

const actualApi = await import('@feed/api');
const actualDb = await import('@feed/db');

const mockAuthenticate = mock();
const mockAsSystem = mock();
const mockAsUser = mock();
const mockRequireNftChatAccess = mock();

mock.module('@feed/api', () => ({
  ...actualApi,
  authenticate: mockAuthenticate,
}));

mock.module('@feed/api/services/nft-chat-gating-service', () => ({
  requireNftChatAccess: mockRequireNftChatAccess,
}));

mock.module('@feed/db', () => ({
  ...actualDb,
  asSystem: mockAsSystem,
  asUser: mockAsUser,
}));

const { GET } = await import('../route');

const GAME_CHAT = {
  id: 'game-chat-1',
  name: 'Game Chat',
  isGroup: true,
  gameId: 'continuous',
  createdAt: new Date(),
  updatedAt: new Date(),
  nftGated: false,
  requiredNftContractAddress: null,
};

/** Minimal chainable query stub that resolves to `rows` when awaited. */
function queryReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'from', 'where', 'orderBy', 'groupBy']) {
    chain[method] = () => chain;
  }
  chain.limit = async () => rows;
  chain.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  return chain;
}

function callGet(url: string, chatId = GAME_CHAT.id) {
  return GET(new Request(url) as never, {
    params: Promise.resolve({ id: chatId }),
  }) as Promise<Response>;
}

describe('GET /api/chats/[id]', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockAsSystem.mockReset();
    mockAsUser.mockReset();
    mockRequireNftChatAccess.mockReset();
    mockAsSystem.mockImplementation(
      async (callback: (db: unknown) => Promise<unknown>) =>
        callback(queryReturning([GAME_CHAT]))
    );
  });

  it('rejects debug=true for a game chat without authentication', async () => {
    mockAuthenticate.mockRejectedValue(
      new actualApi.AuthError('Authentication required')
    );

    const response = await callGet(
      `http://localhost/api/chats/${GAME_CHAT.id}?debug=true`
    );

    expect(response.status).toBe(401);
    expect(mockAsSystem).not.toHaveBeenCalled();
    expect(mockAsUser).not.toHaveBeenCalled();
  });

  it('rejects authenticated users who are not active participants', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'user-1' });
    mockAsUser.mockImplementation(
      async (_user: unknown, callback: (db: unknown) => Promise<unknown>) =>
        callback(queryReturning([]))
    );

    const response = await callGet(
      `http://localhost/api/chats/${GAME_CHAT.id}?debug=true`
    );

    expect(response.status).toBe(403);
    expect(mockRequireNftChatAccess).not.toHaveBeenCalled();
  });

  it('rejects partial-number and out-of-range limits', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'user-1' });

    for (const limit of ['10abc', '0', '101', '-5']) {
      const response = await callGet(
        `http://localhost/api/chats/${GAME_CHAT.id}?limit=${limit}`
      );
      expect(response.status).toBe(400);
    }
    expect(mockAsSystem).not.toHaveBeenCalled();
  });

  it('rejects combining cursor and after', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'user-1' });

    const response = await callGet(
      `http://localhost/api/chats/${GAME_CHAT.id}?cursor=m1&after=2026-01-01T00:00:00.000Z`
    );
    expect(response.status).toBe(400);
  });

  it('rejects a cursor that does not belong to the chat', async () => {
    mockAuthenticate.mockResolvedValue({ userId: 'user-1' });
    let asUserCalls = 0;
    mockAsUser.mockImplementation(
      async (_user: unknown, callback: (db: unknown) => Promise<unknown>) => {
        asUserCalls += 1;
        // 1st call: membership check (active member). 2nd call: history
        // fetch where the participants query returns a member and the cursor
        // lookup (scoped to this chat) finds nothing.
        if (asUserCalls === 1) return callback(queryReturning([{ id: 'p1' }]));
        return callback(queryReturning([]));
      }
    );

    const response = await callGet(
      `http://localhost/api/chats/${GAME_CHAT.id}?cursor=other-chat-message`
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe('Invalid pagination cursor');
  });
});
