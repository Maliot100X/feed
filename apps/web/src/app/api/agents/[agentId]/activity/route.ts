/**
 * Agent Activity API
 *
 * @route GET /api/agents/[agentId]/activity - Get agent activity (trades, posts, comments)
 * @access Authenticated (owner only)
 *
 * @description
 * Returns recent activity for a specific agent including trades, posts, and comments.
 * Used for the real-time Activity feed in the agent detail page.
 */

import { agentService } from '@feed/agents';
import { authenticateUser, withErrorHandling } from '@feed/api';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getAgentActivity,
  parseAgentActivityQuery,
} from '@/lib/agents/agent-activity';

export const GET = withErrorHandling(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await authenticateUser(req);
  const { agentId } = await params;

  // Verify user owns this agent
  const agent = await agentService.getAgent(agentId, user.id);

  if (!agent) {
    return NextResponse.json(
      { success: false, error: 'Agent not found or access denied' },
      { status: 404 }
    );
  }

  const { limit, type } = parseAgentActivityQuery(
    new URL(req.url).searchParams
  );

  const { activities, hasMore } = await getAgentActivity({
    agentIds: [agentId],
    limit,
    type,
  });

  return NextResponse.json({
    success: true,
    agentId,
    agentName: agent.displayName,
    activities,
    pagination: {
      limit,
      count: activities.length,
      hasMore,
    },
  });
});
