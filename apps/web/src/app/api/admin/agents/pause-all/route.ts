/**
 * Admin Agents Pause All API
 *
 * @route POST /api/admin/agents/pause-all - Pause all agents
 * @access Admin
 *
 * @description
 * Emergency endpoint to pause ALL autonomous agents immediately. Disables
 * all autonomous behaviors (trading, posting, commenting, DMs, group chats).
 * Admin only.
 *
 * @openapi
 * /api/admin/agents/pause-all:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Pause all agents
 *     description: Emergency pause for all autonomous agents (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: All agents paused successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                   description: Number of agents paused
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * await fetch('/api/admin/agents/pause-all', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` }
 * });
 * ```
 */

import {
  getClientIp,
  logAdminModify,
  requireAdmin,
  withErrorHandling,
} from '@feed/api';
import { db, userAgentConfigs } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const POST = withErrorHandling(async (req: NextRequest) => {
  const admin = await requireAdmin(req);

  // Pause ALL autonomous agents immediately by updating their configs
  // Status 'paused' matches the per-agent toggle so resume-all can restore
  // exactly the administratively paused agents.
  const paused = await db
    .update(userAgentConfigs)
    .set({
      autonomousTrading: false,
      autonomousPosting: false,
      autonomousCommenting: false,
      autonomousDMs: false,
      autonomousGroupChats: false,
      status: 'paused',
      updatedAt: new Date(),
    })
    .returning({ userId: userAgentConfigs.userId });

  await logAdminModify({
    adminId: admin.userId,
    ipAddress: getClientIp(req.headers) ?? undefined,
    resourceType: 'agents',
    metadata: { action: 'emergency_pause_all', paused: paused.length },
  });

  logger.warn(
    `EMERGENCY: Paused ${paused.length} autonomous agents`,
    undefined,
    'AdminAgentsAPI'
  );

  return NextResponse.json({
    success: true,
    message: `Paused ${paused.length} agents`,
    data: {
      paused: paused.length,
    },
  });
});
