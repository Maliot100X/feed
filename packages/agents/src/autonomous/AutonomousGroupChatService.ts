/**
 * Autonomous Group Chat Service
 *
 * Handles agents participating in group chats autonomously
 *
 * @packageDocumentation
 */

import type { IAgentRuntime } from '@elizaos/core';
import {
  and,
  db,
  desc,
  eq,
  groups,
  gte,
  inArray,
  messages,
  sql,
  users,
} from '@feed/db';
import { StaticDataRegistry } from '@feed/engine';
import { callGroqDirect } from '../llm/direct-groq';
import { getAgentConfig } from '../shared/agent-config';
import { logger } from '../shared/logger';
import { getAgentContext } from './agent-context';
import { executeDirectMessage } from './DirectExecutors';

/** Maximum length of an autonomous group chat message. */
export const MAX_GROUP_CHAT_MESSAGE_LENGTH = 200;

/**
 * Whether someone mentioned the agent *after* the agent's own latest message.
 * `recentMessagesDesc` must be ordered newest-first. Mentions the agent has
 * already replied to do not trigger another response.
 */
export function hasUnansweredMention(
  recentMessagesDesc: ReadonlyArray<{ content: string; senderId: string }>,
  agentUserId: string,
  agentDisplayName: string
): boolean {
  const name = agentDisplayName.trim().toLowerCase();
  if (!name) return false;
  for (const m of recentMessagesDesc) {
    if (m.senderId === agentUserId) return false;
    if (m.content.toLowerCase().includes(name)) return true;
  }
  return false;
}

/**
 * Service for autonomous group chat participation
 */
export class AutonomousGroupChatService {
  /**
   * Participates in group chats the agent is a member of
   *
   * @param agentUserId - Agent user ID
   * @param _runtime - Agent runtime (reserved for future use)
   * @returns Number of messages created
   * @throws Error if agent not found
   */
  async participateInGroupChats(
    agentUserId: string,
    _runtime: IAgentRuntime
  ): Promise<number> {
    // Resolve agent context (NPC vs USER_CONTROLLED)
    const { displayName: agentDisplayName } =
      await getAgentContext(agentUserId);

    const config = await getAgentConfig(agentUserId);

    // Get a rotating sample of the agent's active chat memberships. Random
    // ordering in SQL means chats beyond the limit are not permanently excluded.
    const groupChatsRaw = await db.query.chatParticipants.findMany({
      where: (chatParticipants, { and, eq }) =>
        and(
          eq(chatParticipants.userId, agentUserId),
          eq(chatParticipants.isActive, true)
        ),
      with: {
        chat: true,
      },
      orderBy: () => sql`random()`,
      limit: 20,
    });

    let messagesCreated = 0;

    // Filter out team chats (Agents) - agents shouldn't auto-respond there
    // Team chats use group.type = 'team'
    const groupIds = [
      ...new Set(
        groupChatsRaw
          .map((c) => c.chat?.groupId)
          .filter((gid): gid is string => !!gid)
      ),
    ];

    let teamGroupIds = new Set<string>();
    if (groupIds.length > 0) {
      const teamGroups = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(inArray(groups.id, groupIds), eq(groups.type, 'team')));
      teamGroupIds = new Set(teamGroups.map((g) => g.id));
    }

    for (const chatParticipant of groupChatsRaw) {
      const chat = chatParticipant.chat;
      if (!chat || !chat.isGroup) continue; // Skip DMs

      // Skip team chats (Agents) - user explicitly triggers agent responses there
      if (chat.groupId && teamGroupIds.has(chat.groupId)) {
        continue;
      }

      // Get recent messages in this group (24h lookback for strategic continuity)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentMessages = await db
        .select()
        .from(messages)
        .where(
          and(eq(messages.chatId, chat.id), gte(messages.createdAt, oneDayAgo))
        )
        .orderBy(desc(messages.createdAt))
        .limit(15);

      if (recentMessages.length === 0) continue;

      // Only mentions newer than the agent's own latest message count, so a
      // mention the agent already answered does not trigger repeat replies.
      const agentMentioned = hasUnansweredMention(
        recentMessages,
        agentUserId,
        agentDisplayName
      );

      // Don't spam - only respond if mentioned OR significant conversation activity
      const agentLastMessage = recentMessages.find(
        (m: { content: string; senderId: string }) => m.senderId === agentUserId
      );
      const hasRecentConversation = recentMessages.length >= 3;
      const shouldRespond =
        agentMentioned || (!agentLastMessage && hasRecentConversation);
      if (!shouldRespond) {
        continue;
      }

      // Resolve sender names for multi-party conversation clarity
      const senderIds = [
        ...new Set(
          recentMessages
            .map((m: { senderId: string }) => m.senderId)
            .filter((id: string) => id !== agentUserId)
        ),
      ];
      const senderNames = new Map<string, string>();
      const userIdsToLookup: string[] = [];
      for (const id of senderIds) {
        const npc = StaticDataRegistry.getActor(id);
        if (npc) {
          senderNames.set(id, npc.name);
        } else {
          userIdsToLookup.push(id);
        }
      }
      if (userIdsToLookup.length > 0) {
        const userRows = await db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, userIdsToLookup));
        for (const u of userRows) {
          senderNames.set(u.id, u.displayName || u.id);
        }
      }

      // Generate contextual response
      const prompt = `${config?.systemPrompt ?? 'You are an AI agent on Feed.'}

You are ${agentDisplayName} in a group chat.

Recent conversation:
${recentMessages
  .reverse()
  .map(
    (m: { content: string; senderId: string }) =>
      `${m.senderId === agentUserId ? 'You' : senderNames.get(m.senderId) || 'User'}: ${m.content}`
  )
  .join('\n')}

Task: Generate a helpful, engaging message (1-2 sentences) that contributes to the conversation.
Be authentic to your personality and expertise.
Keep it under ${MAX_GROUP_CHAT_MESSAGE_LENGTH} characters.
Only respond if you have something valuable to add.

IMPORTANT: If mentioning prediction markets, use SHORT SUMMARIES not full questions.
❌ BAD: "the 'Will TeslAI achieve full self-driving readiness by Q1 2025?' prediction"
✅ GOOD: "the TeslAI readiness bet" or "the BitcAIn drop prediction"

Generate ONLY the message text, or "SKIP" if you shouldn't respond.`;

      // Use large model (qwen3-32b) for quality group chat content
      const responseContent = await callGroqDirect({
        prompt,
        modelSize: 'large', // Important social content
        runtime: _runtime, // Pass runtime to access W&B trained models AND trajectory context
        temperature: 0.8,
        maxTokens: 80,
        actionType: 'generate_group_chat_response',
        purpose: 'response', // RLAIF: This is a response generation call
      });

      const cleanContent = responseContent.trim().replace(/^["']|["']$/g, '');

      if (
        !cleanContent ||
        cleanContent.length < 5 ||
        cleanContent.toUpperCase() === 'SKIP'
      ) {
        continue;
      }

      if (cleanContent.length > MAX_GROUP_CHAT_MESSAGE_LENGTH) {
        logger.warn(
          `Discarding over-length group chat message (${cleanContent.length} chars)`,
          { agentUserId, chatId: chat.id },
          'AutonomousGroupChat'
        );
        continue;
      }

      // Create group message
      const result = await executeDirectMessage({
        agentUserId,
        chatId: chat.id,
        content: cleanContent,
      });

      if (!result.success) {
        logger.warn(
          `Failed to create group chat message: ${result.error}`,
          undefined,
          'AutonomousGroupChat'
        );
        continue;
      }

      messagesCreated++;
      logger.info(
        `Agent ${agentDisplayName} participated in group chat ${chat.id}`,
        undefined,
        'AutonomousGroupChat'
      );

      // Allow up to 3 group chat responses per tick for cross-pollination
      if (messagesCreated >= 3) break;
    }

    return messagesCreated;
  }
}

export const autonomousGroupChatService = new AutonomousGroupChatService();
