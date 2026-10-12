/**
 * Agent Team Chat (Agents) API
 *
 * @route GET /api/agents/team-chat - Get user's team chat info
 * @route POST /api/agents/team-chat - Ensure team chat exists (creates if needed)
 * @access Authenticated
 *
 * @description
 * Manages the unified "Agents" group chat for a user's agents.
 * Each user has exactly ONE team chat containing ALL their agents.
 *
 * The team chat is automatically created when the first agent is created,
 * but this endpoint allows explicit creation/retrieval.
 *
 * @openapi
 * /api/agents/team-chat:
 *   get:
 *     tags:
 *       - Agents
 *     summary: Get team chat info
 *     description: Returns the user's Agents team chat with member list.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Team chat info with members
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 teamChat:
 *                   type: object
 *                   properties:
 *                     chatId:
 *                       type: string
 *                     groupId:
 *                       type: string
 *                     agents:
 *                       type: array
 *       404:
 *         description: No team chat exists (user has no agents)
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags:
 *       - Agents
 *     summary: Ensure team chat exists
 *     description: Creates team chat if it doesn't exist, returns existing if it does.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Team chat info
 *       401:
 *         description: Unauthorized
 */

import { teamChatService } from '@feed/agents';
import { authenticateUser, withErrorHandling } from '@feed/api';
import { db, inArray, userAgentConfigs } from '@feed/db';
import { logger, toISO } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * GET /api/agents/team-chat
 * Get user's team chat info with member list
 */
export const GET = withErrorHandling(async function GET(req: NextRequest) {
  const user = await authenticateUser(req);

  const teamChatWithMembers = await teamChatService.getTeamChatWithMembers(
    user.id
  );

  if (!teamChatWithMembers) {
    return NextResponse.json(
      {
        success: false,
        error: 'No team chat exists',
        message: 'Create your first agent to initialize your Agents chat.',
      },
      { status: 404 }
    );
  }

  logger.info(
    `Team chat retrieved for user ${user.id}`,
    { chatId: teamChatWithMembers.chatId },
    'TeamChatAPI'
  );

  // Fetch modelTier for each agent from userAgentConfigs
  const agentIds = teamChatWithMembers.agents.map((a) => a.id);
  const agentConfigs =
    agentIds.length > 0
      ? await db
          .select({
            userId: userAgentConfigs.userId,
            modelTier: userAgentConfigs.modelTier,
          })
          .from(userAgentConfigs)
          .where(inArray(userAgentConfigs.userId, agentIds))
      : [];

  // Create a map for quick lookup
  const modelTierMap = new Map(
    agentConfigs.map((c) => [c.userId, c.modelTier])
  );

  return NextResponse.json({
    success: true,
    teamChat: {
      id: teamChatWithMembers.id,
      chatId: teamChatWithMembers.chatId,
      groupId: teamChatWithMembers.groupId,
      createdAt: toISO(teamChatWithMembers.createdAt),
      updatedAt: toISO(teamChatWithMembers.updatedAt),
      agents: teamChatWithMembers.agents.map((agent) => ({
        id: agent.id,
        username: agent.username,
        displayName: agent.displayName,
        profileImageUrl: agent.profileImageUrl,
        isAgent: agent.isAgent,
        modelTier: modelTierMap.get(agent.id) ?? 'free',
        virtualBalance: Number(agent.virtualBalance ?? 0),
      })),
      agentCount: teamChatWithMembers.agents.length,
    },
  });
});

/**
 * POST /api/agents/team-chat
 * Ensure team chat exists (creates if needed) and sync existing agents
 */
export const POST = withErrorHandling(async function POST(req: NextRequest) {
  const user = await authenticateUser(req);

  // Always create Agents chat - even with 0 agents
  // This allows users to see the Agents UI before creating their first agent
  const teamChat = await teamChatService.ensureTeamChat(user.id);

  // Sync any existing agents that aren't in the team chat yet
  // (handles agents created before the team chat feature was implemented)
  const syncedCount = await teamChatService.syncExistingAgents(user.id);

  const agents = await teamChatService.getTeamChatAgents(
    user.id,
    teamChat.groupId
  );

  logger.info(
    `Team chat ensured for user ${user.id}`,
    { chatId: teamChat.chatId, syncedAgents: syncedCount },
    'TeamChatAPI'
  );

  // Fetch modelTier for each agent from userAgentConfigs
  const agentIds = agents.map((a) => a.id);
  const agentConfigs =
    agentIds.length > 0
      ? await db
          .select({
            userId: userAgentConfigs.userId,
            modelTier: userAgentConfigs.modelTier,
          })
          .from(userAgentConfigs)
          .where(inArray(userAgentConfigs.userId, agentIds))
      : [];

  // Create a map for quick lookup
  const modelTierMap = new Map(
    agentConfigs.map((c) => [c.userId, c.modelTier])
  );

  return NextResponse.json({
    success: true,
    teamChat: {
      id: teamChat.id,
      chatId: teamChat.chatId,
      groupId: teamChat.groupId,
      createdAt: toISO(teamChat.createdAt),
      updatedAt: toISO(teamChat.updatedAt),
      agents: agents.map((agent) => ({
        id: agent.id,
        username: agent.username,
        displayName: agent.displayName,
        profileImageUrl: agent.profileImageUrl,
        isAgent: agent.isAgent,
        modelTier: modelTierMap.get(agent.id) ?? 'free',
        virtualBalance: Number(agent.virtualBalance ?? 0),
      })),
      agentCount: agents.length,
    },
    syncedAgents: syncedCount,
  });
});
