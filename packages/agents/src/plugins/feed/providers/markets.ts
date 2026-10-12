import {
  perpetualMarketsContextSchema,
  predictionMarketsContextSchema,
} from './context-contracts';
/**
 * Markets Provider
 * Provides access to prediction markets and perpetual markets via A2A protocol
 *
 * A2A IS REQUIRED - This provider will not work without an active A2A connection
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import type { FeedRuntime } from '../types';
// import type { A2APredictionsResponse, A2APerpetualsResponse } from '../../../types/a2a-responses' // Commented out - not needed

/**
 * Provider: Current Markets
 * Fetches available prediction markets and perp markets via A2A protocol
 */
export const marketsProvider: Provider = {
  name: 'FEED_MARKETS',
  description:
    'Get current available markets for trading (prediction markets and perpetual futures) via A2A protocol',

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const feedRuntime = runtime as FeedRuntime;

    // A2A is REQUIRED
    if (!feedRuntime.a2aClient?.isConnected()) {
      throw new Error(
        'A2A context unavailable: an active connection is required'
      );
    }

    const [predictionsResult, perpetualsResult] = await Promise.all([
      feedRuntime.a2aClient.getPredictions({ status: 'active' }),
      feedRuntime.a2aClient.getPerpetuals(),
    ]);

    const { predictions } =
      predictionMarketsContextSchema.parse(predictionsResult);
    const { perpetuals } =
      perpetualMarketsContextSchema.parse(perpetualsResult);

    const predictionsText =
      predictions.length > 0
        ? `Prediction Markets:\n${predictions

            .map(
              (m) =>
                `- ${m.question} (ID: ${m.id}) | YES: ${m.yesShares.toFixed(2)}, NO: ${m.noShares.toFixed(2)}, Liquidity: $${m.liquidity.toFixed(2)}`
            )
            .join('\n')}`
        : 'No active prediction markets available.';

    const perpetualsText =
      perpetuals.length > 0
        ? `Perpetual Markets:\n${perpetuals

            .map(
              (p) =>
                `- ${p.name} (ticker: ${p.ticker}) | Price: $${p.currentPrice.toFixed(2)}`
            )
            .join('\n')}`
        : 'No perpetual markets available.';

    return {
      text: `${predictionsText}\n\n${perpetualsText}`,
    };
  },
};
