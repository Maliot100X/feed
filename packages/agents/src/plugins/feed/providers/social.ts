import { requireContextArray } from './context-contracts';
/**
 * Social Feed Provider
 * Provides access to social feed and posts via A2A protocol
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import type { FeedRuntime } from '../types';
// import type { A2AFeedResponse, A2ATrendingTagsResponse } from '../../../types/a2a-responses' // Commented out - not needed

/**
 * Provider: Recent Feed
 * Gets recent posts from the Feed social feed via A2A
 */
export const feedProvider: Provider = {
  name: 'FEED_FEED',
  description: 'Get recent posts from the Feed social feed via A2A protocol',

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const feedRuntime = runtime as FeedRuntime;

    // A2A is required
    if (!feedRuntime.a2aClient?.isConnected()) {
      throw new Error(
        'A2A context unavailable: an active connection is required'
      );
    }

    // Validate feedResult structure
    const feedResult = await feedRuntime.a2aClient.getFeed({ limit: 20 });
    if (!feedResult || typeof feedResult !== 'object') {
      throw new Error('Invalid feed result format from A2A client');
    }
    type FeedResult = {
      posts?: Array<{
        id: string;
        content: string;
        authorId: string;
        timestamp: string | Date;
        type?: string;
      }>;
    };
    const typedFeedResult = feedResult as FeedResult;
    const posts = requireContextArray(typedFeedResult.posts, 'posts');

    if (posts.length === 0) {
      return { text: 'No posts in feed.' };
    }

    const feedText = `Recent Feed Posts:\n${posts
      .map(
        (p, idx) =>
          `${idx + 1}. [${p.type || 'post'}] ${p.content} (Author: ${p.authorId}, ID: ${p.id})`
      )
      .join('\n\n')}`;

    return { text: feedText };
  },
};
