import { beforeEach, describe, expect, mock, test } from 'bun:test';

const checkProgress = mock(
  async (_userId: string, _event: { type: string }) => {
    return undefined;
  }
);

mock.module('@feed/api', () => ({ checkProgress }));

const { trackAgentTradeExecuted } = await import('../track-agent-trade');

describe('trackAgentTradeExecuted', () => {
  beforeEach(() => {
    checkProgress.mockClear();
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_ID;
  });

  test('checks achievement progress even when analytics is not configured', () => {
    trackAgentTradeExecuted('agent-1', {
      agent_id: 'agent-1',
      market_type: 'perp',
      action: 'open',
      owner_id: 'owner-1',
    });
    expect(checkProgress).toHaveBeenCalledTimes(1);
    expect(checkProgress.mock.calls[0]?.[0]).toBe('owner-1');
  });

  test('a rejected achievement check does not throw', async () => {
    checkProgress.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    expect(() =>
      trackAgentTradeExecuted('agent-1', {
        agent_id: 'agent-1',
        market_type: 'prediction',
        action: 'buy',
        owner_id: 'owner-2',
      })
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(checkProgress).toHaveBeenCalledTimes(1);
  });
});
