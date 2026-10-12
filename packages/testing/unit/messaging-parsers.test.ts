/** Exercise actual messaging handlers; targets and content come from structured action parameters. */
import { beforeEach, expect, mock, test } from 'bun:test';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

const send = mock(async (_params: object) => ({
  success: true,
  messageId: 'saved-message',
  error: undefined as string | undefined,
}));
const group = mock(
  async (_agentId: string, _name: string): Promise<string | null> =>
    'group-chat'
);
const user = mock(
  async (_name: string): Promise<string | null> => 'recipient-id'
);
mock.module('../../agents/src/autonomous/DirectExecutors', () => ({
  executeDirectMessage: send,
}));
mock.module('../../agents/src/autonomous/utils/context-gatherers', () => ({
  resolveGroupChatByName: group,
  resolveUserByUsername: user,
}));
const { sendMessageAction, createGroupAction } = await import(
  '../../agents/src/plugins/feed/actions/messaging'
);
const runtime = {
  a2aClient: {
    agentId: 'exact-agent',
    isConnected: () => true,
    createGroup: async () => ({
      success: true,
      group: { id: 'group', chatId: 'chat', name: 'Actual group' },
    }),
  },
} as unknown as IAgentRuntime;
const message = {
  content: { text: 'This unrelated prose must not be sent' },
} as Memory;
const state = (actionParams: object) =>
  ({ values: {}, text: '', data: { actionParams } }) as State;
beforeEach(() => {
  send.mockClear();
  group.mockClear();
  user.mockClear();
  send.mockResolvedValue({
    success: true,
    messageId: 'saved-message',
    error: undefined,
  });
  group.mockResolvedValue('group-chat');
  user.mockResolvedValue('recipient-id');
});

test('exact chat and content reach the authorized executor and its outcome is returned', async () => {
  const result = await sendMessageAction.handler(
    runtime,
    message,
    state({ chatId: 'exact-chat', content: 'Full content: no rewriting' })
  );
  expect(send).toHaveBeenCalledWith({
    agentUserId: 'exact-agent',
    chatId: 'exact-chat',
    recipientId: undefined,
    content: 'Full content: no rewriting',
  });
  expect(result).toMatchObject({
    success: true,
    data: { messageId: 'saved-message' },
  });
});

test('named destinations resolve only the explicitly selected target', async () => {
  await sendMessageAction.handler(
    runtime,
    message,
    state({ groupName: 'Price Alerts', content: 'hello' })
  );
  expect(group).toHaveBeenCalledWith('exact-agent', 'Price Alerts');
  expect(send.mock.calls[0]?.[0]).toMatchObject({ chatId: 'group-chat' });
  await sendMessageAction.handler(
    runtime,
    message,
    state({ username: '@alice', content: 'hello' })
  );
  expect(user).toHaveBeenCalledWith('@alice');
  expect(send.mock.calls[1]?.[0]).toMatchObject({
    recipientId: 'recipient-id',
  });
});

test('missing and ambiguous destinations fail without delivery or fallback', async () => {
  for (const params of [
    { content: 'hello' },
    { chatId: 'a', recipientId: 'b', content: 'hello' },
    { chatId: 'a', content: '' },
  ]) {
    await expect(
      sendMessageAction.handler(runtime, message, state(params))
    ).rejects.toThrow();
  }
  group.mockResolvedValue(null);
  await expect(
    sendMessageAction.handler(
      runtime,
      message,
      state({ groupName: 'Unknown', content: 'hello' })
    )
  ).rejects.toThrow('No active group');
  expect(send).not.toHaveBeenCalled();
  expect(user).not.toHaveBeenCalled();
});

test('delivery and callback failures propagate instead of reporting success', async () => {
  send.mockResolvedValue({
    success: false,
    messageId: '',
    error: 'Access denied',
  });
  await expect(
    sendMessageAction.handler(
      runtime,
      message,
      state({ recipientId: 'recipient', content: 'hello' })
    )
  ).rejects.toThrow('Access denied');
  send.mockResolvedValue({
    success: true,
    messageId: 'saved-message',
    error: undefined,
  });
  await expect(
    sendMessageAction.handler(
      runtime,
      message,
      state({ recipientId: 'recipient', content: 'hello' }),
      undefined,
      async () => {
        throw new Error('Callback failed');
      }
    )
  ).rejects.toThrow('Callback failed');
});

test('group creation requires an explicit member list and returns the nested backend group', async () => {
  await expect(
    createGroupAction.handler(runtime, message, state({ name: 'Group' }))
  ).rejects.toThrow();
  expect(
    await createGroupAction.handler(
      runtime,
      message,
      state({ name: 'Group', memberIds: ['recipient'] })
    )
  ).toMatchObject({ success: true, data: { group: { chatId: 'chat' } } });
});
