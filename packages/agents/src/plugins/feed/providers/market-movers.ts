import { organizationMentionsContextSchema } from './context-contracts';
/**
 * Market Movers Provider
 * Provides top gainers and losers in the market via A2A protocol
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import { logger } from '../../../shared/logger';
import type { FeedRuntime } from '../types';

/**
 * Provider: Market Movers (Gainers & Losers)
 * Gets top gaining and losing stocks/companies via A2A protocol
 */
export const marketMoversProvider: Provider = {
  name: 'FEED_MARKET_MOVERS',
  description:
    'Get top market gainers and losers (stocks with biggest price changes) via A2A protocol',

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

    try {
      // Get organizations via A2A (validated against the canonical contract)
      const orgsResult = await feedRuntime.a2aClient.getOrganizations(100);
      const { organizations } =
        organizationMentionsContextSchema.parse(orgsResult);

      if (organizations.length === 0) {
        return { text: 'No market data available.' };
      }

      // Only tradable markets (canonical ticker) with a quoted price and a
      // reported change percentage are ranked. Tickers are never invented and
      // lifetime initialPrice deltas are not mixed with the reported window.
      const withChanges = organizations.flatMap((org) =>
        org.ticker &&
        org.currentPrice !== null &&
        org.priceChangePercentage !== null
          ? [
              {
                id: org.id,
                name: org.name,
                ticker: org.ticker,
                price: org.currentPrice,
                change: org.priceChangePercentage,
              },
            ]
          : []
      );

      // Get top 5 gainers (positive change)
      const gainers = withChanges
        .filter((c) => c.change > 0)
        .sort((a, b) => b.change - a.change)
        .slice(0, 5);

      // Get top 5 losers (negative change)
      const losers = withChanges
        .filter((c) => c.change < 0)
        .sort((a, b) => a.change - b.change)
        .slice(0, 5);

      const gainersText =
        gainers.length > 0
          ? gainers
              .map(
                (g, i) =>
                  `${i + 1}. ${g.ticker} - ${g.name} - $${g.price.toFixed(2)} (+${g.change.toFixed(2)}%)`
              )
              .join('\n')
          : 'No gainers';

      const losersText =
        losers.length > 0
          ? losers
              .map(
                (l, i) =>
                  `${i + 1}. ${l.ticker} - ${l.name} - $${l.price.toFixed(2)} (${l.change.toFixed(2)}%)`
              )
              .join('\n')
          : 'No losers';

      return {
        text: `Market Movers:

📈 TOP GAINERS:
${gainersText}

📉 TOP LOSERS:
${losersText}`,
        data: {
          gainers: gainers.map((g) => ({
            id: g.id,
            name: g.name,
            ticker: g.ticker,
            price: g.price,
            change: g.change,
          })),
          losers: losers.map((l) => ({
            id: l.id,
            name: l.name,
            ticker: l.ticker,
            price: l.price,
            change: l.change,
          })),
        },
      };
    } catch (error) {
      logger.error(
        'Failed to fetch market movers via A2A',
        { error: error instanceof Error ? error.message : String(error) },
        'MarketMoversProvider'
      );
      throw error;
    }
  },
};
