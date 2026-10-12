/**
 * Portfolio Provider
 * Provides access to agent's portfolio and positions via A2A protocol
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import type { FeedRuntime } from '../types';
import {
  balanceContextSchema,
  positionsContextSchema,
} from './context-contracts';

/**
 * Provider: Portfolio State
 * Gets agent's current positions and balance via A2A
 */
export const portfolioProvider: Provider = {
  name: 'FEED_PORTFOLIO',
  description:
    'Get agent portfolio state, positions, and balance via A2A protocol',

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const feedRuntime = runtime as FeedRuntime;
    const agentUserId = runtime.agentId;

    // A2A is required
    if (!feedRuntime.a2aClient?.isConnected()) {
      throw new Error(
        'A2A context unavailable: an active connection is required'
      );
    }

    const [balanceData, positionsData] = await Promise.all([
      feedRuntime.a2aClient.sendRequest('a2a.getBalance', {
        userId: agentUserId,
      }),
      feedRuntime.a2aClient.sendRequest('a2a.getPositions', {
        userId: agentUserId,
      }),
    ]);

    const balance = balanceContextSchema.parse(balanceData);
    const positions = positionsContextSchema.parse(positionsData);

    return {
      text: `Your Portfolio:

Balance: $${balance.balance || 0}
Points Balance: ${balance.reputationPoints || 0} pts

Open Prediction Positions (${positions.marketPositions?.length || 0}):
${positions.marketPositions?.map((p) => `- ${p.question}: ${p.side} ${p.shares} shares @ avg ${p.avgPrice}`).join('\n') || 'None'}

Open Perp Positions (${positions.perpPositions?.length || 0}):
${
  positions.perpPositions
    ?.map((p) => {
      const amount = p.amount || p.size;
      return `- ${p.ticker}: ${p.side.toUpperCase()} $${amount} @ ${p.entryPrice} (${p.leverage}x)
  Current: $${p.currentPrice}`;
    })
    .join('\n') || 'None'
}`,
    };
  },
};
