/**
 * Dashboard Provider
 * Provides comprehensive agent context and state via A2A protocol
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
import {
  balanceContextSchema,
  positionsContextSchema,
  requireContextArray,
} from './context-contracts';

/**
 * Provider: Comprehensive Dashboard
 * Provides complete agent context including portfolio, markets, social, and pending items
 * ALL DATA FETCHED VIA A2A PROTOCOL
 */
export const dashboardProvider: Provider = {
  name: 'FEED_DASHBOARD',
  description:
    'Get comprehensive agent dashboard with portfolio, markets, social feed, and pending interactions via A2A protocol',

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const feedRuntime = runtime as FeedRuntime;
    const agentUserId = runtime.agentId;

    // A2A is REQUIRED
    if (!feedRuntime.a2aClient?.isConnected()) {
      throw new Error(
        'A2A context unavailable: an active connection is required'
      );
    }

    // Fetch ALL dashboard data via A2A protocol
    const [balance, positions, predictions, feed, chats, notifications] =
      await Promise.all([
        feedRuntime.a2aClient.sendRequest('a2a.getBalance', {
          userId: agentUserId,
        }),
        feedRuntime.a2aClient.sendRequest('a2a.getPositions', {
          userId: agentUserId,
        }),
        feedRuntime.a2aClient.getPredictions({ status: 'active' }),
        feedRuntime.a2aClient.getFeed({ limit: 5 }),
        feedRuntime.a2aClient.getChats('all'),
        feedRuntime.a2aClient.getNotifications(5),
      ]);

    const balanceData = balanceContextSchema.parse(balance);
    const positionsData = positionsContextSchema.parse(positions);
    const predictionsData = predictions as {
      predictions?: Array<{ id: string; question: string }>;
    };
    const feedData = feed as { posts?: Array<{ id: string; content: string }> };
    const chatsData = chats as { chats?: Array<{ id: string; name?: string }> };
    const notificationsData = notifications as {
      notifications?: Array<{ id: string; message: string }>;
    };

    requireContextArray(predictionsData.predictions, 'predictions');
    requireContextArray(feedData.posts, 'posts');
    requireContextArray(chatsData.chats, 'chats');
    requireContextArray(notificationsData.notifications, 'notifications');
    const totalPositions =
      (positionsData.marketPositions?.length || 0) +
      (positionsData.perpPositions?.length || 0);
    const activeMarkets = predictionsData.predictions?.length || 0;
    const recentPosts = feedData.posts?.length || 0;
    const activeChats = chatsData.chats?.length || 0;
    const unreadNotifications = notificationsData.notifications?.length || 0;

    const result = `📊 AGENT DASHBOARD

💰 PORTFOLIO
Balance: $${balanceData.balance || 0}
Points: ${balanceData.reputationPoints || 0} pts
Open Positions: ${totalPositions}

📈 MARKETS
Active Markets: ${activeMarkets}
${
  predictionsData.predictions && predictionsData.predictions.length > 0
    ? `Recent: ${predictionsData.predictions.map((p) => p.question).join(', ')}`
    : 'No active markets'
}

📱 SOCIAL FEED
Recent Posts: ${recentPosts}
${
  feedData.posts && feedData.posts.length > 0 && feedData.posts[0]?.content
    ? `Latest: ${feedData.posts[0].content}...`
    : 'No recent posts'
}

💬 MESSAGING
Active Chats: ${activeChats}
${
  chatsData.chats && chatsData.chats.length > 0
    ? `Chats: ${chatsData.chats.map((c) => c.name || c.id).join(', ')}`
    : 'No active chats'
}

🔔 NOTIFICATIONS
Unread: ${unreadNotifications}
${
  notificationsData.notifications &&
  notificationsData.notifications.length > 0 &&
  notificationsData.notifications[0]?.message
    ? `Latest: ${notificationsData.notifications[0].message}...`
    : 'No notifications'
}

💡 OPPORTUNITIES
- ${totalPositions > 0 ? 'Monitor open positions' : 'Consider opening positions'}
- ${activeMarkets > 0 ? 'Review active markets' : 'Check for new markets'}
- ${recentPosts > 0 ? 'Engage with recent posts' : 'Create new posts'}
- ${unreadNotifications > 0 ? 'Review notifications' : 'All caught up'}`;

    return { text: result };
  },
};
