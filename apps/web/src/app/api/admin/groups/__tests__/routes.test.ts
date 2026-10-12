import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';

const now = new Date('2026-10-01T00:00:00Z');
const rankedSubquery = { ranked: true };
let messageFindManyArgs: object[] = [];

function resultFor(source: object, grouped: boolean): object[] {
  if (source === actualDb.chats) {
    return [
      {
        id: 'chat-1',
        name: 'Group',
        groupId: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
  if (source === actualDb.chatParticipants) {
    return [{ chatId: 'chat-1', userId: 'u1', joinedAt: now }];
  }
  if (source === rankedSubquery) {
    return [
      {
        id: 'm1',
        chatId: 'chat-1',
        senderId: 'u1',
        content: 'hi',
        createdAt: now,
      },
    ];
  }
  if (source === actualDb.messages && grouped) {
    return [{ chatId: 'chat-1', count: 42 }];
  }
  if (source === actualDb.users) {
    return [
      {
        id: 'u1',
        username: 'u1',
        displayName: 'U1',
        isActor: false,
        profileImageUrl: null,
      },
    ];
  }
  return [];
}

function select() {
  let source: object = {};
  let grouped = false;
  const c = {
    from: (s: object) => {
      source = s;
      return c;
    },
    where: () => c,
    orderBy: () => c,
    groupBy: () => {
      grouped = true;
      return c;
    },
    as: () => rankedSubquery,
    then: (resolve: (rows: object[]) => void) =>
      resolve(resultFor(source, grouped)),
  };
  return c;
}

mock.module('@feed/db', () => ({
  ...actualDb,
  asSystem: async (fn: (db: { select: typeof select }) => Promise<object>) =>
    fn({ select }),
  db: {
    chat: {
      findUnique: async () => ({
        id: 'chat-1',
        name: 'Group',
        isGroup: true,
        createdAt: now,
      }),
    },
    message: {
      count: async () => 0,
      findMany: async (args: object) => {
        messageFindManyArgs.push(args);
        return [];
      },
    },
    user: { findMany: async () => [] },
  },
}));

mock.module('@feed/engine', () => ({
  StaticDataRegistry: { getActor: () => null },
}));

mock.module('@feed/api', () => ({
  getClientIp: () => null,
  logAdminView: async () => undefined,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  withErrorHandling: (handler: () => Promise<Response>) => handler,
}));

const list = (await import('../route')).GET;
const messagesRoute = (await import('../[id]/messages/route')).GET;

describe('admin groups', () => {
  beforeEach(() => {
    messageFindManyArgs = [];
  });

  it('reports the real message count, not the 10-message preview size', async () => {
    const res = (await list(
      new Request('http://localhost/api/admin/groups') as never
    )) as Response;
    const body = await res.json();
    expect(body.data.groups[0].messageCount).toBe(42);
    expect(body.data.groups[0].recentMessages).toHaveLength(1);
  });

  it('rejects NaN/negative/huge pagination for group messages', async () => {
    for (const q of ['limit=abc', 'limit=-5', 'offset=-1', 'limit=100000']) {
      const res = (await messagesRoute(
        new Request(
          `http://localhost/api/admin/groups/chat-1/messages?${q}`
        ) as never,
        { params: Promise.resolve({ id: 'chat-1' }) }
      )) as Response;
      expect(res.status).toBe(400);
    }
    expect(messageFindManyArgs).toHaveLength(0);
  });

  it('paginates group messages with a stable id tie-break', async () => {
    const res = (await messagesRoute(
      new Request('http://localhost/api/admin/groups/chat-1/messages') as never,
      { params: Promise.resolve({ id: 'chat-1' }) }
    )) as Response;
    expect(res.status).toBe(200);
    expect(messageFindManyArgs[0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 100,
    });
  });
});
