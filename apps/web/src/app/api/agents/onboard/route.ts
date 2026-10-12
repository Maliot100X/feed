/**
 * Agent Onboarding API
 *
 * @route POST /api/agents/onboard - Create/refresh the local Feed user for an authenticated agent session
 * @route GET /api/agents/onboard - Report whether that local user exists
 * @access Authenticated agent session
 *
 * @description
 * Local registration only: this endpoint does NOT register anything on-chain
 * (no Agent0/ERC-8004 transaction, no IPFS metadata). On-chain registry state
 * is not reported here.
 *
 * @openapi
 * /api/agents/onboard:
 *   post:
 *     tags:
 *       - Agents
 *     summary: Register agent locally
 *     description: Creates (or refreshes the display name of) the local Feed user for the authenticated agent session. No on-chain registration is performed.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agentName
 *             properties:
 *               agentName:
 *                 type: string
 *               endpoint:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Agent registered locally
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not an agent session
 *   get:
 *     tags:
 *       - Agents
 *     summary: Local registration status
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: isRegistered reflects whether the local user exists
 *
 * @example
 * ```typescript
 * await fetch('/api/agents/onboard', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${agentSessionToken}` },
 *   body: JSON.stringify({ agentName: 'My Agent' })
 * });
 * ```
 */

import {
  AuthorizationError,
  authenticate,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { asUser, db, eq, users } from '@feed/db';
import { AgentOnboardSchema, generateSnowflakeId, logger } from '@feed/shared';
import type { NextRequest } from 'next/server';

/**
 * POST /api/agents/onboard
 * Register an agent to the on-chain identity system
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  // Authenticate agent FIRST
  const user = await authenticate(request);
  if (!user.isAgent || !user.userId) {
    throw new AuthorizationError(
      'Only agents can use this endpoint',
      'agent',
      'onboard'
    );
  }

  const agentId = user.userId;

  // Parse and validate request body
  const body = await request.json();
  const { agentName } = AgentOnboardSchema.parse(body);

  // Upsert the local user keyed by username (avoids create races) with RLS.
  // TODO(finding 242): this creates a separate funded identity outside the
  // canonical ledger and does not set isAgent; changing that needs a funding
  // policy decision, so only the read-back/overwrite bugs are fixed here.
  const registeredUser = await asUser(user, async (scopedDb) => {
    await scopedDb.user.upsert({
      where: {
        username: agentId, // Use username as unique identifier for agents
      },
      update: {
        // Only refresh the display name; never overwrite a user-edited bio.
        displayName: agentName,
      },
      create: {
        id: await generateSnowflakeId(),
        privyId: agentId,
        username: agentId,
        displayName: agentName,
        virtualBalance: '10000', // Start with 10k points
        totalDeposited: '10000',
        bio: `Autonomous AI agent: ${agentId}`,
        updatedAt: new Date(),
      },
    });

    // Read back by the same key the upsert used.
    const userWithFields = await scopedDb.user.findUnique({
      where: { username: agentId },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
      },
    });

    if (!userWithFields) {
      throw new Error('Failed to create or find user');
    }

    return userWithFields;
  });

  logger.info(
    'Agent onboarded successfully',
    { agentId },
    'POST /api/agents/onboard'
  );

  return successResponse({
    message: 'Agent registered locally (no on-chain registration performed)',
    agentId,
    userId: registeredUser.id,
    registered: true,
  });
});

/**
 * GET /api/agents/onboard
 * Check agent registration status
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const user = await authenticate(request);
  if (!user.isAgent || !user.userId) {
    throw new AuthorizationError(
      'Only agents can use this endpoint',
      'agent',
      'check-status'
    );
  }

  const agentId = user.userId;

  const [registered] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, agentId))
    .limit(1);

  logger.info(
    'Agent registration status checked',
    { agentId, isRegistered: Boolean(registered) },
    'GET /api/agents/onboard'
  );

  return successResponse({
    isRegistered: Boolean(registered),
    agentId,
    userId: registered?.id ?? null,
  });
});
