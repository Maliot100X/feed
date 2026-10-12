/**
 * A2A Agent Card Endpoint
 *
 * @route GET /api/agents/[agentId]/card - Get agent card
 * @access Public
 *
 * @description
 * Returns A2A-compatible agent card for discovery and capability advertisement.
 * Follows Agent0 SDK v0.31.0 conventions for OASF taxonomy and A2A endpoints.
 *
 * @openapi
 * /api/agents/{agentId}/card:
 *   get:
 *     tags:
 *       - Agents
 *       - A2A Protocol
 *     summary: Get agent card
 *     description: Returns A2A agent card with capabilities, skills, domains, and endpoints
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent identifier
 *     responses:
 *       200:
 *         description: Agent card retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version:
 *                   type: string
 *                   example: "1.0"
 *                 agentId:
 *                   type: string
 *                 name:
 *                   type: string
 *                 description:
 *                   type: string
 *                 endpoints:
 *                   type: object
 *                 capabilities:
 *                   type: object
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/agents/npc-trader-001/card');
 * const agentCard = await response.json();
 * // Use with Agent0 SDK:
 * await agent.setA2A(agentCard.endpoints.a2a);
 * ```
 *
 * @see {@link /types/agent-registry.types} AgentCard type definition
 * @see {@link https://sdk.ag0.xyz/} Agent0 SDK documentation
 */

import type { AgentCard } from '@feed/agents';
import { agentRegistry } from '@feed/agents';
import { withErrorHandling } from '@feed/api';
import { db, eq, users } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  // Get agent from registry
  const agent = await agentRegistry.getAgentById(agentId);

  if (!agent) {
    return NextResponse.json(
      { error: 'Agent not found', agentId },
      { status: 404 }
    );
  }

  // Check if agent already has discovery metadata
  if (agent.discoveryMetadata) {
    return NextResponse.json(agent.discoveryMetadata, { status: 200 });
  }

  // Build agent card from registration data
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  // Public description comes from the public profile bio. The system prompt is
  // private agent configuration and must never be published here.
  const [profile] = agent.userId
    ? await db
        .select({ bio: users.bio })
        .from(users)
        .where(eq(users.id, agent.userId))
        .limit(1)
    : [];

  const externalA2aEndpoint = agent.capabilities.a2aEndpoint;

  const agentCard: AgentCard = {
    version: '1.0',
    agentId: agent.agentId,
    name: agent.name,
    description: profile?.bio || 'Autonomous agent on Feed platform',
    endpoints: {
      a2a: externalA2aEndpoint || `${baseUrl}/api/agents/${agentId}/a2a`,
      // Only advertise an MCP endpoint the agent actually declared; Feed does
      // not host per-agent MCP endpoints.
      ...(agent.capabilities.mcpEndpoint
        ? { mcp: agent.capabilities.mcpEndpoint }
        : {}),
      rpc: `${baseUrl}/api/agents/${agentId}/card`,
    },
    capabilities: agent.capabilities,
    // Feed-hosted per-agent A2A requires an API key (X-Feed-Api-Key). For an
    // externally hosted endpoint we cannot vouch for its auth or limits.
    ...(externalA2aEndpoint
      ? {}
      : { authentication: { required: true, methods: ['apiKey'] } }),
  };

  logger.info(
    `Agent card retrieved for ${agentId}`,
    {
      agentType: agent.type,
      skillsCount: agent.capabilities.skills?.length || 0,
      domainsCount: agent.capabilities.domains?.length || 0,
    },
    'AgentCard'
  );

  return NextResponse.json(agentCard, { status: 200 });
});
