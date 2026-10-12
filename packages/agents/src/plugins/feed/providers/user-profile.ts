/**
 * User Profile Provider
 * Allows agents to view any user's profile information via A2A protocol
 * This is useful for understanding other users, checking their reputation, etc.
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
  userProfileContextSchema,
} from './context-contracts';

/**
 * Provider: View User Profile
 * Gets any user's profile information via A2A protocol
 *
 * Usage in prompts: "Show me user X's profile" or "What is user Y's reputation?"
 */
export const userProfileProvider: Provider = {
  name: 'FEED_USER_PROFILE',
  description:
    "View any user's profile including username, display name, bio, reputation points, and other public information via A2A protocol. Useful for understanding other users and their activity.",

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

    const userId = explicitContextUserId(message);
    if (!userId)
      return {
        text: 'To query a profile, supply its exact account ID as userId: <id>. Resolve usernames to IDs before querying.',
      };

    // Fetch profile data via A2A protocol
    const profileData = await feedRuntime.a2aClient.getUserProfile(userId);

    const profile = userProfileContextSchema.parse(profileData);
    if (profile.id !== userId)
      throw new Error('Profile response does not match the requested account');

    return {
      text: `User Profile: ${profile.displayName || profile.username || profile.id}

👤 Username: ${profile.username || 'Not set'}
📝 Display Name: ${profile.displayName || 'Not set'}
${profile.bio ? `📄 Bio: ${profile.bio}` : ''}
⭐ Reputation Points: ${profile.reputationPoints} pts
💰 Balance: $${profile.virtualBalance}
${profile.profileImageUrl ? `🖼️  Profile Image: ${profile.profileImageUrl}` : ''}

User ID: ${profile.id}`,
    };
  },
};
