import { describe, expect, mock, test } from 'bun:test';

const snapshot = (chatId: string, fact: string) => ({
  value: JSON.stringify({
    chatId,
    chatName: chatId,
    summary: 's',
    facts: [fact],
    participantNames: [],
    messageCount: 1,
    lastMessageAt: '2026-01-01T00:00:00.000Z',
    refreshedAt: '2026-01-01T00:00:00.000Z',
  }),
});

const storedRows = [
  snapshot('chat-a', 'fact from A'),
  snapshot('chat-b', 'fact from B'),
];

const chain = {
  select: () => chain,
  from: () => chain,
  where: () => chain,
  orderBy: () => chain,
  limit: async () => storedRows,
};

const realDb = await import('@feed/db');
mock.module('@feed/db', () => ({ ...realDb, db: chain }));

const memberships: Record<string, Array<{ id: string }>> = {
  'agent-a': [{ id: 'chat-a' }],
  'agent-b': [{ id: 'chat-b' }],
  outsider: [],
};
mock.module('../../services/group-chat-service', () => ({
  GroupChatService: {
    getUserGroupChats: async (userId: string) => memberships[userId] ?? [],
  },
}));

const { sharedChatContextService } = await import(
  '../../services/shared-chat-context-service'
);

describe('sharedChatContextService.getSharedFacts', () => {
  test('agents in disjoint private groups only see their own group facts', async () => {
    const a = await sharedChatContextService.getSharedFacts({
      viewerUserId: 'agent-a',
    });
    const b = await sharedChatContextService.getSharedFacts({
      viewerUserId: 'agent-b',
    });
    expect(a.map((f) => f.fact)).toEqual(['fact from A']);
    expect(b.map((f) => f.fact)).toEqual(['fact from B']);
  });

  test('non-members get no facts', async () => {
    expect(
      await sharedChatContextService.getSharedFacts({
        viewerUserId: 'outsider',
      })
    ).toEqual([]);
  });
});
