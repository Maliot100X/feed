/**
 * Tests for POST /api/realtime/token using the production route handler and
 * the real DM chat-id helper (DB and token signer are mocked).
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const USER_ID = 'user-123';

interface ParticipantQuery {
  where: { userId: string; chatId: { in: string[] }; isActive?: boolean };
}

let activeParticipantChatIds: string[] = [];
let ownedAgentIds: string[] = [];
const participantFindManyMock = mock(async (query: ParticipantQuery) =>
  query.where.chatId.in
    .filter((chatId) => activeParticipantChatIds.includes(chatId))
    .map((chatId) => ({ chatId }))
);
const issueRealtimeTokenMock = mock(
  (_input: { userId: string; channels: string[]; ttlSeconds: number }) =>
    'signed-token'
);

const apiModulePath = new URL(
  '../../../../../../../../packages/api/src/index.ts',
  import.meta.url
).pathname;
const apiModuleFactory = () => ({
  authenticate: async () => ({ userId: USER_ID, dbUserId: USER_ID }),
  issueRealtimeToken: issueRealtimeTokenMock,
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
});

const dbModulePath = new URL(
  '../../../../../../../../packages/db/src/index.ts',
  import.meta.url
).pathname;
const dbModuleFactory = () => ({
  and: () => undefined,
  db: {
    chatParticipant: { findMany: participantFindManyMock },
    select: () => ({
      from: () => ({
        where: async () => ownedAgentIds.map((id) => ({ id })),
      }),
    }),
  },
  eq: () => undefined,
  inArray: () => undefined,
  users: {},
});

mock.module('@feed/api', apiModuleFactory);
mock.module(apiModulePath, apiModuleFactory);
mock.module('@feed/db', dbModuleFactory);
mock.module(dbModulePath, dbModuleFactory);

function post(body?: object | string): NextRequest {
  return new NextRequest('https://feed.example/api/realtime/token', {
    method: 'POST',
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
  });
}

async function loadPost(): Promise<(req: NextRequest) => Promise<Response>> {
  const module = await import('../route');
  return module.POST;
}

describe('POST /api/realtime/token', () => {
  beforeEach(() => {
    activeParticipantChatIds = [];
    ownedAgentIds = [];
    participantFindManyMock.mockClear();
    issueRealtimeTokenMock.mockClear();
  });

  it('issues public channels plus notifications for an empty body', async () => {
    const POST = await loadPost();
    const response = await POST(post());
    const body = (await response.json()) as { channels: string[] };

    expect(response.status).toBe(200);
    expect(body.channels).toEqual([
      'feed',
      'markets',
      'breaking-news',
      'upcoming-events',
      `notifications:${USER_ID}`,
    ]);
  });

  it('only checks active chat participation', async () => {
    activeParticipantChatIds = ['group-1'];
    const POST = await loadPost();
    const response = await POST(post({ chatIds: ['group-1'] }));

    expect(response.status).toBe(200);
    const [query] = participantFindManyMock.mock.calls[0] ?? [];
    expect(query?.where.isActive).toBe(true);
    const body = (await response.json()) as { channels: string[] };
    expect(body.channels).toContain('chat:group-1');
  });

  it('rejects chats the user is not an active participant of', async () => {
    const POST = await loadPost();
    const response = await POST(post({ channels: ['chat:group-2'] }));

    expect(response.status).toBe(403);
    expect(issueRealtimeTokenMock).not.toHaveBeenCalled();
  });

  it('allows deterministic DM ids that include the user (hyphenated ids)', async () => {
    const POST = await loadPost();
    const response = await POST(
      post({ chatIds: [`dm-${USER_ID}-other-user-9`] })
    );
    expect(response.status).toBe(200);
  });

  it('rejects DM ids that do not include the user', async () => {
    const POST = await loadPost();
    const response = await POST(post({ chatIds: ['dm-alice-bob'] }));
    expect(response.status).toBe(403);
  });

  it('includes only owned agent channels', async () => {
    ownedAgentIds = ['agent-1'];
    const POST = await loadPost();
    const response = await POST(
      post({ agentIds: ['agent-1'], channels: ['agent:agent-2'] })
    );
    const body = (await response.json()) as { channels: string[] };

    expect(body.channels).toContain('agent:agent-1');
    expect(body.channels).not.toContain('agent:agent-2');
  });

  it('does not coerce the string "false" to true for includeNotifications', async () => {
    const POST = await loadPost();
    await expect(
      POST(post({ includeNotifications: 'false' }))
    ).rejects.toThrow();
  });

  it('omits notifications when includeNotifications is false', async () => {
    const POST = await loadPost();
    const response = await POST(post({ includeNotifications: false }));
    const body = (await response.json()) as { channels: string[] };
    expect(body.channels).not.toContain(`notifications:${USER_ID}`);
  });

  it('rejects oversized id arrays', async () => {
    const POST = await loadPost();
    const chatIds = Array.from({ length: 101 }, (_, i) => `c${i}`);
    await expect(POST(post({ chatIds }))).rejects.toThrow();
    expect(participantFindManyMock).not.toHaveBeenCalled();
  });

  it('passes the requested TTL to the signer', async () => {
    const POST = await loadPost();
    await POST(post({ ttlSeconds: 60 }));
    const [input] = issueRealtimeTokenMock.mock.calls[0] ?? [];
    expect(input?.ttlSeconds).toBe(60);
  });
});
