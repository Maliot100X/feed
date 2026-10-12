/**
 * User Wallet Provider
 * Allows agents to query ANY user's wallet balance and positions via A2A protocol
 * This is useful for analyzing other traders, following successful strategies, etc.
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
  explicitContextUserId,
  userWalletContextSchema,
} from './context-contracts';

/**
 * Provider: Query User Wallet
 * Gets any user's wallet balance and positions via A2A protocol
 *
 * Usage in prompts: "Check user X's wallet" or "What positions does user Y have?"
 */
export const userWalletProvider: Provider = {
  name: 'FEED_USER_WALLET',
  description:
    "Query any user's wallet balance, points, and open positions via A2A protocol. Useful for analyzing other traders and following successful strategies.",

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const feedRuntime = runtime as FeedRuntime;

    // A2A is REQUIRED
    if (!feedRuntime.a2aClient?.isConnected()) {
      throw new Error(
        'A2A context unavailable: an active connection is required'
      );
    }

    // A display name or a substring of prose is not a canonical account ID.
    const userId = explicitContextUserId(message);
    if (!userId) {
      return {
        text: 'To query a wallet, supply its exact account ID as userId: <id>. Resolve usernames to IDs before querying.',
      };
    }

    // Fetch wallet data via A2A protocol
    const walletData = await feedRuntime.a2aClient.sendRequest(
      'a2a.getUserWallet',
      { userId }
    );

    const { balance, positions } = userWalletContextSchema.parse(walletData);

    const totalPositions =
      positions.marketPositions.length + positions.perpPositions.length;
    const lifetimePnL = balance.lifetimePnL;
    const isProfitable = lifetimePnL > 0;

    return {
      text: `User ${userId}'s Wallet:

💰 Balance: $${balance.balance}
⭐ Points: ${balance.reputationPoints} pts
${isProfitable ? '📈' : '📉'} Lifetime P&L: ${isProfitable ? '+' : ''}$${lifetimePnL}
💵 Total Deposited: $${balance.totalDeposited}
💸 Total Withdrawn: $${balance.totalWithdrawn}

📊 Open Positions (${totalPositions}):

${
  positions.perpPositions && positions.perpPositions.length > 0
    ? `🔮 Perpetual Futures (${positions.perpPositions.length}):
${positions.perpPositions
  .map((p) => {
    const amount = p.amount ?? p.size;
    return `  • ${p.ticker}: ${p.side.toUpperCase()} $${amount} @ ${p.entryPrice} (${p.leverage}x)
    Current: $${p.currentPrice} | P&L: ${p.unrealizedPnL >= 0 ? '+' : ''}$${p.unrealizedPnL}`;
  })
  .join('\n')}`
    : '🔮 No perpetual positions'
}

${
  positions.marketPositions && positions.marketPositions.length > 0
    ? `🎯 Prediction Markets (${positions.marketPositions.length}):
${positions.marketPositions
  .map(
    (p) => `  • ${p.side} on "${p.question}"
    ${p.shares.toFixed(2)} shares @ $${p.avgPrice.toFixed(3)} (Current: $${p.currentPrice.toFixed(3)})
    P&L: ${p.unrealizedPnL >= 0 ? '+' : ''}$${p.unrealizedPnL.toFixed(2)}`
  )
  .join('\n')}`
    : '🎯 No prediction market positions'
}

${
  isProfitable
    ? `This user appears to be a profitable trader with $${lifetimePnL} in gains.`
    : `This user has $${Math.abs(lifetimePnL)} in losses.`
}`,
    };
  },
};
