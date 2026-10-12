import {
  chatsContextSchema,
  requireContextArray,
  requireContextNumber,
} from './context-contracts';
/**
 * Messaging Provider
 * Provides access to chats and messages via A2A protocol
 *
 * A2A IS REQUIRED - These providers will not work without an active A2A connection
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import type { FeedRuntime } from '../types';
// import type { A2AChatsResponse, A2AUnreadCountResponse, A2ANotificationsResponse } from '../../../types/a2a-responses' // Commented out - not needed

/**
 * Provider: Unread Messages
 * Gets agent's unread DMs and group chats via A2A
 */
export const messagesProvider: Provider = {
  name: 'FEED_MESSAGES',
  description: 'Get unread messages and recent chats via A2A protocol',

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

    const [chatsResult, unreadResult] = await Promise.all([
      feedRuntime.a2aClient.getChats(),
      feedRuntime.a2aClient.getUnreadCount(),
    ]);

    const unreadData = unreadResult as { unreadCount?: number };

    const { chats } = chatsContextSchema.parse(chatsResult);
    const unreadCount = requireContextNumber(
      unreadData.unreadCount,
      'unreadCount'
    );

    const chatsText =
      chats.length > 0
        ? `Chats:\n${chats
            .map(
              (c) =>
                `- ${c.name || 'Unnamed'} (${c.isGroup ? 'Group' : 'DM'}) | ID: ${c.id} | Participants: ${c.participants.length}`
            )
            .join('\n')}`
        : 'No chats available.';

    return {
      text: `${chatsText}\n\nUnread messages: ${unreadCount}`,
    };
  },
};

/**
 * Provider: Notifications
 * Gets agent's recent notifications via A2A
 */
export const notificationsProvider: Provider = {
  name: 'FEED_NOTIFICATIONS',
  description: 'Get recent notifications via A2A protocol',

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

    const notificationsResult =
      await feedRuntime.a2aClient.getNotifications(20);
    const notifications = requireContextArray(
      (
        notificationsResult as {
          notifications?: Array<{
            id: string;
            type: string;
            message: string;
            read: boolean;
            createdAt: string | Date;
          }>;
        }
      )?.notifications,
      'notifications'
    );
    const unreadCount = requireContextNumber(
      (notificationsResult as { unreadCount?: number })?.unreadCount,
      'unreadCount'
    );

    if (notifications.length === 0) {
      return { text: 'No notifications available.' };
    }

    const notificationsText = `Notifications (${unreadCount} unread):\n${notifications
      .map(
        (n, idx) =>
          `${idx + 1}. [${n.read ? 'READ' : 'UNREAD'}] ${n.type}: ${n.message} (ID: ${n.id})`
      )
      .join('\n\n')}`;

    return { text: notificationsText };
  },
};
