/**
 * Coordinator Dispatch History Provider
 *
 * Provides the coordinator with structured knowledge of what each agent has
 * recently said/done in the team chat — across all turns, not just the current one.
 *
 * Without this, the coordinator only sees its own coordinator↔user conversation
 * (from RECENT_MESSAGES) and is blind to agent responses from previous turns.
 * This causes hallucinations like "it seems @bob did respond" when the coordinator
 * genuinely cannot see bob's message in its context window.
 *
 * The provider fetches all messages sent by agents (users with isAgent=true) in
 * the team chat and formats them as a labelled log with timestamps and content
 * previews, so the coordinator can:
 * - Quote what an agent actually said
 * - Know whether a dispatch produced a visible response
 * - Avoid re-dispatching when a response already exists
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import { and, db, desc, eq, messages as messagesTable, users } from '@feed/db';
import {
  formatClockTime,
  formatRelativeTime,
} from '../../../conversation-time';

/** Max chars to include per agent message before truncating */
const PREVIEW_LENGTH = 400;

export const coordinatorDispatchHistoryProvider: Provider = {
  name: 'DISPATCH_HISTORY',
  description: 'Recent responses from agents in this team chat',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state: State
  ): Promise<ProviderResult> => {
    const teamChatId = state?.values?.teamChatId as string | undefined;

    if (!teamChatId) {
      return {
        data: { agentMessages: [], count: 0 },
        values: { dispatchHistory: '', hasDispatchHistory: false },
        text: '',
      };
    }

    // Fetch recent agent messages — join on users.isAgent to avoid fetching
    // user or coordinator messages, which are covered by RECENT_MESSAGES.
    const agentMessages = await db
      .select({
        id: messagesTable.id,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
        senderId: messagesTable.senderId,
        username: users.username,
        displayName: users.displayName,
      })
      .from(messagesTable)
      .innerJoin(
        users,
        and(eq(messagesTable.senderId, users.id), eq(users.isAgent, true))
      )
      .where(eq(messagesTable.chatId, teamChatId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(10);

    if (agentMessages.length === 0) {
      return {
        data: { agentMessages: [], count: 0 },
        values: {
          dispatchHistory: 'No agent responses in this chat yet.',
          hasDispatchHistory: false,
        },
        text: '',
      };
    }

    // Format oldest-first (reverse the newest-first DB result) for conversational flow
    const formatted = [...agentMessages]
      .reverse()
      .map((msg) => {
        const handle = msg.username
          ? `@${msg.username}`
          : (msg.displayName ?? 'Agent');
        const time = formatClockTime(msg.createdAt);
        const rel = formatRelativeTime(msg.createdAt);
        const preview =
          msg.content.length > PREVIEW_LENGTH
            ? `${msg.content.slice(0, PREVIEW_LENGTH)}…`
            : msg.content;
        return `${time} (${rel}) ${handle}: "${preview}"`;
      })
      .join('\n');

    const header = `## Recent Agent Responses in Team Chat\n`;
    const fullText = header + formatted;

    return {
      data: { agentMessages, count: agentMessages.length },
      values: {
        dispatchHistory: fullText,
        hasDispatchHistory: true,
        agentMessageCount: agentMessages.length,
      },
      text: fullText,
    };
  },
};
