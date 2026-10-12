import { describe, expect, test } from 'bun:test';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';
import { marketMoversProvider } from './market-movers';

const org = (
  id: string,
  ticker: string | null,
  currentPrice: number | null,
  priceChangePercentage: number | null
) => ({
  id,
  name: `${id} Corp`,
  ticker,
  description: '',
  imageUrl: null,
  currentPrice,
  initialPrice: 1,
  priceChangePercentage,
});

function runtimeWith(organizations: ReturnType<typeof org>[]) {
  return {
    agentId: 'agent-1',
    a2aClient: {
      isConnected: () => true,
      getOrganizations: async () => ({ organizations }),
    },
  } as unknown as IAgentRuntime;
}

describe('marketMoversProvider', () => {
  test('never invents tickers and skips markets without a reported change', async () => {
    const result = await marketMoversProvider.get(
      runtimeWith([
        org('alpha', 'ALPHA', 10, 5),
        org('noticker', null, 10, 50),
        org('nochange', 'NOCH', 10, null),
        org('beta', 'BETA', 4, -3),
      ]),
      { content: { text: '' } } as Memory,
      {} as State
    );
    expect(result.text).toContain('ALPHA');
    expect(result.text).toContain('BETA');
    expect(result.text).not.toContain('noticker');
    expect(result.text).not.toContain('NOTIC');
    expect(result.text).not.toContain('NOCH');
  });
});
