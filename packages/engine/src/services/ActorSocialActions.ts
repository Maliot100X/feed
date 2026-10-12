/**
 * Actor Social Actions Service
 *
 * Handles actors randomly inviting users to group chats or sending DMs
 * based on interaction history and social relationships.
 */

import {
  and,
  asc,
  chats,
  count,
  db,
  eq,
  groupMembers,
  groups,
  gte,
  inArray,
  sql,
  userInteractions,
} from '@feed/db';
import { logger } from '@feed/shared';
import { NPC_SOCIAL_ACTIONS_CONFIG } from '../config/npc-activity';
import { clamp01 } from '../utils/math-utils';
import { findDMChat, getOrCreateDMChat, sendMessageToChat } from './dm-service';
import { GroupChatService } from './group-chat-service';
import { StaticDataRegistry } from './static-data-registry';

export interface SocialAction {
  type: 'group_chat_invite' | 'dm';
  userId: string;
  actorId: string;
  chatId?: string;
  chatName?: string;
  dmContent?: string;
}

export class ActorSocialActions {
  /**
   * Process random social actions for actors
   * Called periodically to randomly invite users or send DMs
   */
  static async processRandomSocialActions(): Promise<SocialAction[]> {
    const actions: SocialAction[] = [];

    const actorList = StaticDataRegistry.getAllActors();
    const actorIds = actorList.map((actor) => actor.id);
    if (actorIds.length === 0) return actions;

    // Aggregate every interaction per (npc, user) pair in the database so the
    // count/quality thresholds see real totals, and IDs are never re-parsed
    // from a composite string (actor IDs routinely contain hyphens).
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const interactionStats = await db
      .select({
        npcId: userInteractions.npcId,
        userId: userInteractions.userId,
        interactionCount: count(),
        avgQuality: sql<number>`avg(${userInteractions.qualityScore})::float8`,
      })
      .from(userInteractions)
      .where(
        and(
          gte(userInteractions.timestamp, sevenDaysAgo),
          inArray(userInteractions.npcId, actorIds)
        )
      )
      .groupBy(userInteractions.npcId, userInteractions.userId);

    const statsByActor = new Map<
      string,
      Array<{ userId: string; interactionCount: number; avgQuality: number }>
    >();
    for (const row of interactionStats) {
      const list = statsByActor.get(row.npcId) ?? [];
      list.push({
        userId: row.userId,
        interactionCount: row.interactionCount,
        avgQuality: row.avgQuality,
      });
      statsByActor.set(row.npcId, list);
    }

    for (const actor of actorList) {
      for (const { userId, interactionCount, avgQuality } of statsByActor.get(
        actor.id
      ) ?? []) {
        if (
          interactionCount < NPC_SOCIAL_ACTIONS_CONFIG.minInteractionsForAction
        ) {
          continue;
        }
        if (avgQuality < NPC_SOCIAL_ACTIONS_CONFIG.minInteractionQuality) {
          continue;
        }

        // Check if user is already in this NPC's group specifically
        const [existingMembership] = await db
          .select({ id: groupMembers.id })
          .from(groupMembers)
          .innerJoin(groups, eq(groups.id, groupMembers.groupId))
          .where(
            and(
              eq(groupMembers.userId, userId),
              eq(groupMembers.isActive, true),
              eq(groups.ownerId, actor.id) // Only check groups owned by this NPC
            )
          )
          .limit(1);

        const hasExistingDM = (await findDMChat(actor.id, userId)) !== null;

        // Calculate probabilities based on interaction quality and count
        // Use safe denominators to prevent division by zero (fallback to 1 if zero)
        const qualityDenominator =
          NPC_SOCIAL_ACTIONS_CONFIG.minInteractionQuality || 1;
        const countDenominator =
          NPC_SOCIAL_ACTIONS_CONFIG.minInteractionsForAction || 1;
        const qualityFactor = Math.min(avgQuality / qualityDenominator, 1.5);
        const countFactor = Math.min(interactionCount / countDenominator, 2.0);

        const inviteProbability = clamp01(
          NPC_SOCIAL_ACTIONS_CONFIG.baseInviteProbability *
            qualityFactor *
            countFactor
        );
        const dmProbability = clamp01(
          NPC_SOCIAL_ACTIONS_CONFIG.baseDmProbability *
            qualityFactor *
            countFactor
        );

        // Randomly decide to invite to group chat
        if (!existingMembership && Math.random() < inviteProbability) {
          // Only invite into a group chat this actor actually owns; never
          // invent a chat ID or borrow another owner's chat.
          const [ownedChat] = await db
            .select({ id: chats.id, name: chats.name })
            .from(chats)
            .innerJoin(groups, eq(groups.id, chats.groupId))
            .where(and(eq(chats.isGroup, true), eq(groups.ownerId, actor.id)))
            .orderBy(asc(chats.createdAt), asc(chats.id))
            .limit(1);
          if (ownedChat) {
            const chatId = ownedChat.id;
            const chatName = ownedChat.name || `${actor.name}'s Inner Circle`;
            await GroupChatService.recordInvite(
              userId,
              actor.id,
              chatId,
              chatName
            );
            actions.push({
              type: 'group_chat_invite',
              userId,
              actorId: actor.id,
              chatId,
              chatName,
            });
            logger.info(
              `Actor ${actor.name} invited user ${userId} to group chat`,
              {
                actorId: actor.id,
                userId,
                chatId,
                chatName,
              },
              'ActorSocialActions'
            );
          }
        }

        // Randomly decide to send DM
        if (!hasExistingDM && Math.random() < dmProbability) {
          const dmChat = await ActorSocialActions.createDMWithMessage(
            actor.id,
            userId
          );
          actions.push({
            type: 'dm',
            userId,
            actorId: actor.id,
            chatId: dmChat.id,
            dmContent: dmChat.messageContent,
          });
          logger.info(
            `Actor ${actor.name} sent DM to user ${userId}`,
            {
              actorId: actor.id,
              userId,
              chatId: dmChat.id,
            },
            'ActorSocialActions'
          );
        }
      }
    }

    logger.info(
      `Processed ${actions.length} social actions`,
      {
        count: actions.length,
        invites: actions.filter((a) => a.type === 'group_chat_invite').length,
        dms: actions.filter((a) => a.type === 'dm').length,
      },
      'ActorSocialActions'
    );

    return actions;
  }

  /**
   * Create a DM chat between an actor and a user with an initial message
   */
  private static async createDMWithMessage(
    actorId: string,
    userId: string
  ): Promise<{ id: string; messageContent: string }> {
    // Generate a DM message content (simple for now, could use LLM)
    const messagesList: string[] = [
      "Hey! I've been noticing your posts. Want to chat?",
      'Thought you might find this interesting...',
      'Quick question for you!',
      'Loved your take on that last post. Mind if I DM you?',
      "Got something I think you'd want to hear.",
    ];
    const randomIndex = Math.floor(Math.random() * messagesList.length);
    const messageContent: string =
      messagesList[randomIndex] ?? messagesList[0] ?? ''; // Safe: randomIndex is always within bounds

    const chatId = await getOrCreateDMChat(actorId, userId);
    await sendMessageToChat(chatId, actorId, messageContent);

    return {
      id: chatId,
      messageContent,
    };
  }
}
