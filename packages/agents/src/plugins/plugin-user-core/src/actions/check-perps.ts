/**
 * CHECK_PERPS Action (Coordinator)
 *
 * Same handler as the agent action (plugin-agent-core); only examples differ.
 *
 * Returns perpetual/stock market data:
 * - Ticker, name, current price
 * - 24h change (absolute and %)
 * - Volume, open interest
 * - Funding rate
 */

import type { Action, IAgentRuntime, Memory, State } from '@elizaos/core';
import { checkPerpsHandler } from '../../../plugin-agent-core/src/actions/check-perps';

export const checkPerpsAction: Action = {
  name: 'CHECK_PERPS',
  description:
    'Check perpetual/stock market data - prices, 24h changes, volume, funding rates. Tickers are AI-themed (e.g., TSLAI for Tesla, AIPPL for Apple).',
  parameters: {
    ticker: {
      type: 'string',
      description:
        'Exact ticker or name for specific market (e.g., "TSLAI" or "TeslAI"). If not found, returns available markets.',
      required: false,
    },
    limit: {
      type: 'number',
      description:
        'Number of markets to show (default: 10, max: 20). Only used when ticker is not provided.',
      required: false,
    },
    sortBy: {
      type: 'string',
      description:
        'Sort by: "price", "change", "volume", "name" (default: "volume"). Only used when ticker is not provided.',
      required: false,
    },
  } as unknown as Action['parameters'],
  examples: [
    [
      {
        name: 'user',
        content: { text: "What's happening in the perp markets?" },
      },
      {
        name: 'coordinator',
        content: { text: "I'll check the perpetual markets for you." },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Show me AIPPL price' },
      },
      {
        name: 'coordinator',
        content: { text: "I'll get the AIPPL market details." },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Which stocks are moving the most?' },
      },
      {
        name: 'coordinator',
        content: { text: 'Let me check the top movers.' },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<boolean> => {
    return true;
  },

  handler: checkPerpsHandler,
};
