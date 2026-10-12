import { describe, expect, mock, test } from 'bun:test';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';
import { entityMentionsProvider } from './entity-mentions';

function makeRuntime(options: {
  users?: Array<{
    id: string;
    username: string;
    reputationPoints: number;
  }>;
  organizations?: Array<{
    id: string;
    name: string;
    ticker: string | null;
    currentPrice: number | null;
    priceChangePercentage: number | null;
  }>;
}) {
  const searchUsers = mock(async (query: string, _limit: number) => ({
    users: (options.users ?? [])
      .filter((u) => u.username.toLowerCase() === query)
      .map((u) => ({
        ...u,
        displayName: null,
        bio: null,
        isAgent: false,
      })),
  }));
  const getOrganizations = mock(async (_limit: number) => ({
    organizations: (options.organizations ?? []).map((o) => ({
      ...o,
      description: '',
      imageUrl: null,
      initialPrice: null,
    })),
  }));
  const runtime = {
    agentId: 'agent-1',
    a2aClient: {
      isConnected: () => true,
      searchUsers,
      getOrganizations,
    },
  } as unknown as IAgentRuntime;
  return { runtime, searchUsers, getOrganizations };
}

const message = (text: string) => ({ content: { text } }) as Memory;
const state = {} as State;

describe('entityMentionsProvider', () => {
  test('matches tickers longer than five characters', async () => {
    const { runtime } = makeRuntime({
      organizations: [
        {
          id: 'openagi',
          name: 'OpenAGI',
          ticker: 'OPENAGI',
          currentPrice: 10,
          priceChangePercentage: 0,
        },
      ],
    });
    const result = await entityMentionsProvider.get(
      runtime,
      message('thoughts on $OPENAGI today?'),
      state
    );
    expect(result.text).toContain('OPENAGI');
    // Real zero change is preserved, not shown as unavailable.
    expect(result.text).toContain('+0.00%');
  });

  test('missing price is shown as not quoted, never $0', async () => {
    const { runtime } = makeRuntime({
      organizations: [
        {
          id: 'acme',
          name: 'Acme',
          ticker: 'ACME',
          currentPrice: null,
          priceChangePercentage: null,
        },
      ],
    });
    const result = await entityMentionsProvider.get(
      runtime,
      message('buying $ACME'),
      state
    );
    expect(result.text).toContain('not quoted');
    expect(result.text).not.toContain('$0');
  });

  test('hyphenated usernames resolve and duplicates issue one lookup', async () => {
    const { runtime, searchUsers } = makeRuntime({
      users: [{ id: 'u1', username: 'ailon-musk', reputationPoints: 0 }],
    });
    const result = await entityMentionsProvider.get(
      runtime,
      message('@ailon-musk said hi, @Ailon-Musk again'),
      state
    );
    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(searchUsers.mock.calls[0]?.[0]).toBe('ailon-musk');
    expect(result.text).toContain('@ailon-musk');
    expect(result.text).toContain('Points: 0');
  });
});
