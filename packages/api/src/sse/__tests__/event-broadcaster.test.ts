/**
 * SSE event broadcaster: verifies the channel and envelope each helper
 * publishes through the realtime layer.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import path from 'node:path';
import type { RealtimeEventEnvelope } from '../../realtime';

const published: RealtimeEventEnvelope[] = [];
let publishFailure: Error | null = null;
let broadcaster: typeof import('../event-broadcaster');

describe('event broadcaster', () => {
  beforeAll(async () => {
    const realtimePath = path.resolve(
      import.meta.dir,
      '../../realtime/index.ts'
    );
    const actual = await import(realtimePath);
    mock.module(realtimePath, () => ({
      ...actual,
      publishEvent: async (event: RealtimeEventEnvelope) => {
        if (publishFailure) throw publishFailure;
        published.push(event);
      },
    }));
    broadcaster = await import('../event-broadcaster');
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    published.length = 0;
    publishFailure = null;
  });

  it('broadcasts agent activity on the agent channel with a typed envelope', async () => {
    await broadcaster.broadcastAgentActivity('agent-1', 'Agent One', 'trade', {
      tradeId: 't-1',
      marketType: 'perp',
      marketId: null,
      ticker: 'ABC',
      action: 'open',
      side: 'long',
      amount: 10,
      price: 2.5,
      pnl: null,
      reasoning: null,
    });

    expect(published).toHaveLength(1);
    const [event] = published;
    expect(event?.channel).toBe('agent:agent-1');
    expect(event?.type).toBe('agent_trade');
    expect(event?.data).toMatchObject({
      type: 'agent_trade',
      activity: {
        type: 'trade',
        agentId: 'agent-1',
        agentName: 'Agent One',
        data: { tradeId: 't-1', ticker: 'ABC' },
      },
    });
  });

  it('broadcasts chat messages to the chat channel', async () => {
    await broadcaster.broadcastChatMessage('chat-9', {
      id: 'm-1',
      content: 'hello',
      chatId: 'chat-9',
      senderId: 'u-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(published[0]?.channel).toBe('chat:chat-9');
    expect(published[0]?.type).toBe('new_message');
    expect(published[0]?.data).toMatchObject({
      message: { id: 'm-1', content: 'hello' },
    });
  });

  it('defaults the event type to update', async () => {
    await broadcaster.broadcastToChannel('feed', { postId: 'p-1' });
    expect(published[0]).toMatchObject({ channel: 'feed', type: 'update' });
  });

  it('propagates publish failures to the caller', async () => {
    publishFailure = new Error('stream down');
    await expect(
      broadcaster.broadcastToChannel('feed', { a: 1 })
    ).rejects.toThrow('stream down');
  });
});
