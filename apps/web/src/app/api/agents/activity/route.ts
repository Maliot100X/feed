/**
 * All Agents Activity API
 *
 * @route GET /api/agents/activity - Get activity from all user's agents
 * @access Authenticated
 *
 * @description
 * Returns recent activity from all agents owned by the authenticated user.
 * Used for the "My Moves" dashboard showing aggregate agent activity.
 */

import { authenticateUser, withErrorHandling } from '@feed/api';
import { and, db, eq, users } from '@feed/db';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getAgentActivity,
  parseAgentActivityQuery,
} from '@/lib/agents/agent-activity';

export const GET = withErrorHandling(async function GET(req: NextRequest) {
  const user = await authenticateUser(req);

  const { limit, type } = parseAgentActivityQuery(
    new URL(req.url).searchParams
  );

  // Agents owned by this user
  const ownedAgents = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      profileImageUrl: users.profileImageUrl,
    })
    .from(users)
    .where(and(eq(users.managedBy, user.id), eq(users.isAgent, true)));

  const agentMap = new Map(
    ownedAgents.map((a) => [
      a.id,
      {
        id: a.id,
        name: a.displayName ?? 'Agent',
        profileImageUrl: a.profileImageUrl,
      },
    ])
  );

  const { activities, hasMore } = await getAgentActivity({
    agentIds: [...agentMap.keys()],
    limit,
    type,
  });

  return NextResponse.json({
    success: true,
    activities: activities.flatMap((activity) => {
      const agent = agentMap.get(activity.agentId);
      return agent ? [{ ...activity, agent }] : [];
    }),
    pagination: {
      limit,
      count: activities.length,
      hasMore,
    },
  });
});
