/**
 * Agent Logs and Activity History API
 *
 * @route GET /api/agents/[agentId]/logs - Get agent logs
 * @access Authenticated (owner only)
 *
 * @description
 * Returns comprehensive activity logs for an agent including autonomous actions,
 * AI model interactions, trading decisions, and system events. Supports filtering
 * by log type and severity level.
 *
 * @openapi
 * /api/agents/{agentId}/logs:
 *   get:
 *     tags:
 *       - Agents
 *     summary: Get agent logs
 *     description: Returns activity logs for agent (owner only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent user ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [chat, trade, post, comment, dm, error, system]
 *         description: Filter by log type
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [debug, info, warn, error]
 *         description: Filter by severity level
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum logs to return
 *     responses:
 *       200:
 *         description: Logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                       level:
 *                         type: string
 *                       message:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not agent owner
 *       404:
 *         description: Agent not found
 *
 * @example
 * ```typescript
 * const { logs } = await fetch(`/api/agents/${agentId}/logs?type=trade&limit=50`, {
 *   headers: { 'Authorization': `Bearer ${token}` }
 * }).then(r => r.json());
 * ```
 *
 * @example
 * ```typescript
 * // Get all logs
 * const logs = await fetch('/api/agents/agent-123/logs')
 *   .then(r => r.json());
 *
 * // Filter by type and level
 * const errorLogs = await fetch(
 *   '/api/agents/agent-123/logs?type=error&level=error&limit=50'
 * ).then(r => r.json());
 *
 * // Get recent trading activity
 * const tradeLogs = await fetch(
 *   '/api/agents/agent-123/logs?type=trade&limit=20'
 * ).then(r => r.json());
 * ```
 *
 * @see {@link /lib/agents/services/AgentService} Log service
 * @see {@link /src/app/agents/[agentId]/page.tsx} Logs UI
 */

import { agentService } from '@feed/agents';
import { authenticateUser, withErrorHandling } from '@feed/api';
import { toISO } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const GET = withErrorHandling(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await authenticateUser(req);
  const { agentId } = await params;

  await agentService.getAgent(agentId, user.id);

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || undefined;
  const level = searchParams.get('level') || undefined;
  const limit = Number.parseInt(searchParams.get('limit')!);

  const logs = await agentService.getLogs(agentId, {
    type,
    level,
    limit,
  });

  return NextResponse.json({
    success: true,
    logs: logs.map((log) => ({
      id: log.id,
      type: log.type,
      level: log.level,
      message: log.message,
      prompt: log.prompt,
      completion: log.completion,
      thinking: log.thinking,
      metadata: log.metadata,
      createdAt: toISO(log.createdAt),
    })),
  });
});
