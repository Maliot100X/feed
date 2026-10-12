/**
 * Individual Agent Management API
 *
 * @route GET /api/agents/[agentId] - Get agent details
 * @route PUT /api/agents/[agentId] - Update agent configuration
 * @route DELETE /api/agents/[agentId] - Delete agent
 * @access Authenticated (owner only)
 *
 * @description
 * Manage individual agent details, configuration, and lifecycle. Provides
 * comprehensive agent information including performance metrics, balance,
 * autonomous action settings, and operational status.
 *
 * @openapi
 * /api/agents/{agentId}:
 *   get:
 *     tags:
 *       - Agents
 *     summary: Get agent details
 *     description: Returns complete agent profile with real-time performance statistics, points balance, and operational status.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent user ID
 *     responses:
 *       200:
 *         description: Agent details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 agent:
 *                   type: object
 *       404:
 *         description: Agent not found
 *       401:
 *         description: Unauthorized
 *   put:
 *     tags:
 *       - Agents
 *     summary: Update agent configuration
 *     description: Updates agent settings, permissions, and configuration. Supports partial updates.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent user ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               system:
 *                 type: string
 *               autonomousEnabled:
 *                 type: boolean
 *               modelTier:
 *                 type: string
 *                 enum: [lite, standard, pro]
 *     responses:
 *       200:
 *         description: Agent updated
 *       404:
 *         description: Agent not found
 *       401:
 *         description: Unauthorized
 *   delete:
 *     tags:
 *       - Agents
 *     summary: Delete agent
 *     description: Permanently deletes agent and all associated data. This action cannot be undone.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent user ID
 *     responses:
 *       200:
 *         description: Agent deleted
 *       404:
 *         description: Agent not found
 *       401:
 *         description: Unauthorized
 *
 * **GET - Retrieve Agent Details**
 *
 * Returns complete agent profile with real-time performance statistics:
 * - Trading performance (PnL, win rate, total trades)
 * - Points balance and spending history
 * - Autonomous action permissions
 * - System prompts and personality configuration
 * - Activity timestamps (last tick, last chat)
 * - On-chain registration status
 *
 * @param {string} agentId - Agent user ID (path parameter)
 *
 * @returns {object} Agent details with performance metrics
 * @property {boolean} success - Operation success
 * @property {object} agent - Complete agent profile and stats
 *
 * **PUT - Update Agent Configuration**
 *
 * Update agent settings, permissions, and configuration. Supports partial
 * updates - only provided fields are modified.
 *
 * @param {string} agentId - Agent user ID (path parameter)
 * @param {string} name - Agent display name (optional)
 * @param {string} description - Agent description (optional)
 * @param {string} profileImageUrl - Profile image URL (optional)
 * @param {string} system - System prompt (optional)
 * @param {string} bio - Biography (optional)
 * @param {string} personality - Personality traits (optional)
 * @param {string} tradingStrategy - Trading strategy (optional)
 * @param {string} modelTier - Model tier: 'lite' | 'standard' | 'pro' (optional)
 * @param {boolean} isActive - Active status (optional)
 * @param {boolean} autonomousEnabled - Enable autonomous actions (optional)
 *
 * @returns {object} Updated agent details
 *
 * **DELETE - Delete Agent**
 *
 * Permanently deletes agent and all associated data. This action cannot be undone.
 *
 * @param {string} agentId - Agent user ID (path parameter)
 *
 * @returns {object} Success confirmation
 *
 * @throws {404} Agent not found or unauthorized
 * @throws {401} Unauthorized - authentication required
 * @throws {500} Internal server error
 *
 * @example
 * ```typescript
 * // Get agent details
 * const agent = await fetch(`/api/agents/${agentId}`, {
 *   headers: { 'Authorization': `Bearer ${token}` }
 * });
 *
 * // Update agent
 * await fetch(`/api/agents/${agentId}`, {
 *   method: 'PUT',
 *   body: JSON.stringify({
 *     autonomousTrading: true,
 *     modelTier: 'pro'
 *   })
 * });
 *
 * // Delete agent
 * await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
 * ```
 *
 * @see {@link /lib/agents/services/AgentService} Agent service
 * @see {@link /src/app/agents/[agentId]/page.tsx} Agent detail page
 */

import {
  agentService,
  getAgentConfig,
  isAutonomousTradingEnabled,
} from '@feed/agents';
import { authenticateUser, withErrorHandling } from '@feed/api';
import { logger, toISO, toISOOrNull } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

/** Bio entries persisted in messageExamples are expected to be strings. */
function stringEntries(value: unknown): string[] | null {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return null;
  return parsed.filter(
    (entry): entry is string =>
      typeof entry === 'string' && entry.trim().length > 0
  );
}

const UpdateAgentSchema = z
  .object({
    name: z.string().max(100).optional(),
    description: z.string().max(5000).optional(),
    profileImageUrl: z.string().max(2048).optional(),
    coverImageUrl: z.string().max(2048).optional(),
    system: z.string().max(20000).optional(),
    bio: z
      .union([
        z.array(z.string().max(2000)).max(50),
        z
          .string()
          .max(20000)
          .transform((bio) => bio.split('\n').filter((b) => b.trim())),
      ])
      .optional(),
    personality: z.string().max(10000).optional(),
    tradingStrategy: z.string().max(10000).optional(),
    modelTier: z.enum(['free', 'pro']).optional(),
    // Both names are accepted: autonomousEnabled (UI) and autonomousTrading (documented).
    autonomousEnabled: z.boolean().optional(),
    autonomousTrading: z.boolean().optional(),
    autonomousPosting: z.boolean().optional(),
    autonomousCommenting: z.boolean().optional(),
    autonomousDMs: z.boolean().optional(),
    autonomousGroupChats: z.boolean().optional(),
    a2aEnabled: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.autonomousEnabled === undefined ||
      body.autonomousTrading === undefined ||
      body.autonomousEnabled === body.autonomousTrading,
    {
      message: 'autonomousEnabled and autonomousTrading disagree',
      path: ['autonomousTrading'],
    }
  );

export const GET = withErrorHandling(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await authenticateUser(req);
  const { agentId } = await params;

  // Ownership first (throws AuthorizationError for agents owned by others).
  const agent = await agentService.getAgent(agentId, user.id);
  if (!agent) {
    return NextResponse.json(
      { success: false, error: 'Agent not found' },
      { status: 404 }
    );
  }

  const [performance, config] = await Promise.all([
    agentService.getPerformance(agentId),
    getAgentConfig(agentId),
  ]);
  const bioEntries = config?.messageExamples
    ? stringEntries(config.messageExamples)
    : null;

  const tradingEnabled = isAutonomousTradingEnabled(config);

  return NextResponse.json({
    success: true,
    agent: {
      id: agent.id,
      username: agent.username,
      name: agent.displayName,
      description: agent.bio,
      profileImageUrl: agent.profileImageUrl,
      coverImageUrl: agent.coverImageUrl,
      // Parse trading strategy from system prompt if it was appended
      system: (() => {
        const system = config?.systemPrompt || '';
        const tradingStrategyMatch = system.match(
          /\n\nTrading Strategy:\s*(.+)$/s
        );
        if (tradingStrategyMatch && config?.tradingStrategy) {
          // If trading strategy exists in DB and is also in system prompt, extract base system
          return system.replace(/\n\nTrading Strategy:\s*.+$/s, '').trim();
        }
        return system;
      })(),
      // Use messageExamples (ElizaOS bio array) if available, otherwise fall back to bio string
      bio:
        bioEntries ??
        (agent.bio ? agent.bio.split('\n').filter((b) => b.trim()) : []),
      // If personality is not set but a bio array exists, join it for display
      personality: config?.personality || (bioEntries ?? []).join('\n'),
      tradingStrategy:
        config?.tradingStrategy ||
        (() => {
          // Extract trading strategy from system prompt if it was appended
          const system = config?.systemPrompt || '';
          const tradingStrategyMatch = system.match(
            /\n\nTrading Strategy:\s*(.+)$/s
          );
          return tradingStrategyMatch ? tradingStrategyMatch[1]!.trim() : '';
        })(),
      virtualBalance: Number(agent.virtualBalance ?? 0),
      totalDeposited:
        agent.totalDeposited == null ? null : Number(agent.totalDeposited),
      totalWithdrawn:
        agent.totalWithdrawn == null ? null : Number(agent.totalWithdrawn),
      isActive: config?.status === 'active',
      autonomousEnabled: tradingEnabled,
      autonomousTrading: tradingEnabled,
      autonomousPosting: config?.autonomousPosting ?? false,
      autonomousCommenting: config?.autonomousCommenting ?? false,
      autonomousDMs: config?.autonomousDMs ?? false,
      autonomousGroupChats: config?.autonomousGroupChats ?? false,
      a2aEnabled: config?.a2aEnabled ?? false,
      modelTier: config?.modelTier === 'pro' ? 'pro' : 'free',
      status: config?.status ?? 'idle',
      errorMessage: config?.errorMessage ?? null,
      lifetimePnL: agent.lifetimePnL.toString(),
      totalTrades: performance.totalTrades,
      profitableTrades: performance.profitableTrades,
      winRate: performance.winRate,
      lastTickAt: toISOOrNull(config?.lastTickAt),
      lastChatAt: toISOOrNull(config?.lastChatAt),
      walletAddress: agent.walletAddress,
      agent0TokenId: null, // TODO: source from AgentRegistry table
      createdAt: toISO(agent.createdAt),
      updatedAt: toISO(agent.updatedAt),
    },
  });
});

export const PUT = withErrorHandling(async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await authenticateUser(req);
  const { agentId } = await params;
  const { autonomousEnabled, autonomousTrading, ...fields } =
    UpdateAgentSchema.parse(await req.json());

  const updates: Parameters<typeof agentService.updateAgent>[2] = {
    ...fields,
    ...((autonomousTrading ?? autonomousEnabled) !== undefined
      ? { autonomousTrading: autonomousTrading ?? autonomousEnabled }
      : {}),
  };

  const agent = await agentService.updateAgent(agentId, user.id, updates);
  const updatedConfig = await getAgentConfig(agentId);

  logger.info(`Agent updated via API: ${agentId}`, undefined, 'AgentsAPI');

  return NextResponse.json({
    success: true,
    agent: {
      id: agent.id,
      username: agent.username,
      name: agent.displayName,
      description: agent.bio,
      profileImageUrl: agent.profileImageUrl,
      coverImageUrl: agent.coverImageUrl,
      virtualBalance: Number(agent.virtualBalance ?? 0),
      autonomousTrading: isAutonomousTradingEnabled(updatedConfig),
      autonomousPosting: updatedConfig?.autonomousPosting ?? false,
      modelTier: updatedConfig?.modelTier === 'pro' ? 'pro' : 'free',
      updatedAt: toISO(agent.updatedAt),
    },
  });
});

export const DELETE = withErrorHandling(async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await authenticateUser(req);
  const { agentId } = await params;

  await agentService.deleteAgent(agentId, user.id);

  logger.info(`Agent deleted via API: ${agentId}`, undefined, 'AgentsAPI');

  return NextResponse.json({
    success: true,
    message: 'Agent deleted successfully',
  });
});
