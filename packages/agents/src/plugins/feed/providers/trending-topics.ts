import { trendingContextSchema } from './context-contracts';
/**
 * Trending Topics Provider
 * Provides current trending tags and topics via A2A protocol
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import type { FeedRuntime } from '../types';

/**
 * Provider: Trending Topics
 * Gets current trending tags and topics via A2A protocol
 */
export const trendingTopicsProvider: Provider = {
  name: 'FEED_TRENDING_TOPICS',
  description:
    'Get currently trending topics and tags on Feed via A2A protocol',

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

    // Get trending tags via A2A
    const trendingResult = await feedRuntime.a2aClient.getTrendingTags(20);
    const { tags } = trendingContextSchema.parse(trendingResult);

    if (tags.length === 0) {
      return { text: 'No trending topics available.' };
    }

    const topicsText = tags
      .map(
        (
          t,
          i
        ) => `${i + 1}. #${t.name}${t.displayName ? ` (${t.displayName})` : ''}
   ${t.category ? `Category: ${t.category}` : ''}${t.postCount !== undefined ? ` | ${t.postCount} posts` : ''}${t.score !== undefined ? ` | Score: ${t.score.toFixed(1)}` : ''}`
      )
      .join('\n\n');

    return {
      text: `🔥 Trending Topics:

${topicsText}`,
      data: {
        topics: tags.map((t) => ({
          id: t.id,
          name: t.name,
          displayName: t.displayName,
          category: t.category,
          postCount: t.postCount,
          score: t.score,
        })),
      },
    };
  },
};
