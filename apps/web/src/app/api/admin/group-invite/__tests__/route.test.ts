import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';

type Chat = {
  id: string;
  name: string | null;
  isGroup: boolean;
  groupId: string | null;
};
type Group = { id: string; name: string; type: string; ownerId: string };

let chatsById: Record<string, Chat> = {};
let groupsById: Record<string, Group> = {};
const inserts: { values: Record<string, string | number | boolean | Date> }[] =
  [];
const notify = mock(async () => undefined);

const fakeTx = {
  insert: () => ({
    values: (values: Record<string, string | number | boolean | Date>) => {
      inserts.push({ values });
      return { onConflictDoUpdate: async () => undefined };
    },
  }),
};

const fakeDb = {
  user: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === 'user-1'
        ? { id: 'user-1', username: 'u1', displayName: 'User 1' }
        : null,
  },
  chat: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      chatsById[where.id] ?? null,
    findMany: async ({ where }: { where: { groupId: { in: string[] } } }) =>
      Object.values(chatsById).filter(
        (c) => c.isGroup && c.groupId && where.groupId.in.includes(c.groupId)
      ),
  },
  group: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      groupsById[where.id] ?? null,
    findMany: async ({ where }: { where: { ownerId: string } }) =>
      Object.values(groupsById).filter(
        (g) => g.ownerId === where.ownerId && g.type === 'npc'
      ),
    count: async () => 0,
  },
  groupMember: {
    findFirst: async () => null,
    findMany: async () => [],
  },
  transaction: async (fn: (tx: typeof fakeTx) => Promise<void>) => fn(fakeTx),
};

mock.module('@feed/db', () => ({
  ...actualDb,
  asSystem: async (fn: (db: typeof fakeDb) => Promise<object | null>) =>
    fn(fakeDb),
  generateSnowflakeId: async () => 'snowflake',
}));

mock.module('@feed/engine', () => ({
  StaticDataRegistry: {
    getActor: (id: string) => (id === 'npc-1' ? { id, name: 'NPC One' } : null),
  },
}));

mock.module('@feed/api', () => ({
  getClientIp: () => null,
  logAdminModify: async () => undefined,
  notifyGroupChatInvite: notify,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { POST } = await import('../route');

function post(body: object) {
  return POST(
    new Request('http://localhost/api/admin/group-invite', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

describe('POST /api/admin/group-invite', () => {
  beforeEach(() => {
    chatsById = {};
    groupsById = {
      'grp-npc': {
        id: 'grp-npc',
        name: 'Inner',
        type: 'npc',
        ownerId: 'npc-1',
      },
      'grp-other': {
        id: 'grp-other',
        name: 'Other',
        type: 'npc',
        ownerId: 'npc-2',
      },
    };
    inserts.length = 0;
    notify.mockClear();
  });

  it('rejects a DM chat without mutating anything', async () => {
    chatsById['dm-1'] = {
      id: 'dm-1',
      name: null,
      isGroup: false,
      groupId: null,
    };
    const res = await post({
      npcId: 'npc-1',
      userId: 'user-1',
      chatId: 'dm-1',
    });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects a group chat owned by a different NPC', async () => {
    chatsById['chat-x'] = {
      id: 'chat-x',
      name: 'X',
      isGroup: true,
      groupId: 'grp-other',
    };
    const res = await post({
      npcId: 'npc-1',
      userId: 'user-1',
      chatId: 'chat-x',
    });
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it('rejects unknown chat ids instead of creating a chat', async () => {
    const res = await post({
      npcId: 'npc-1',
      userId: 'user-1',
      chatId: 'nope',
    });
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });

  it('rejects malformed bodies', async () => {
    const res = await post({ npcId: { evil: true }, userId: 'user-1' });
    expect(res.status).toBe(400);
  });

  it('adds the user to the NPC-owned group without touching chat/group rows', async () => {
    chatsById['chat-npc'] = {
      id: 'chat-npc',
      name: 'Inner Circle',
      isGroup: true,
      groupId: 'grp-npc',
    };
    const res = await post({ npcId: 'npc-1', userId: 'user-1' });
    expect(res.status).toBe(200);
    expect(inserts.map((i) => i.values.chatId ?? i.values.groupId)).toEqual([
      'chat-npc',
      'grp-npc',
    ]);
    expect(notify).toHaveBeenCalledWith(
      'user-1',
      'npc-1',
      'grp-npc',
      'Inner Circle'
    );
  });
});
