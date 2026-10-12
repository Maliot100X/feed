/**
 * Admin Management Promote/Demote API
 *
 * @route POST /api/admin/admins/[userId] - Promote/demote admin
 * @access Super admin
 *
 * @description
 * Promotes a user to admin or demotes an admin to regular user via the legacy
 * isAdmin flag. SUPER_ADMIN only. Cannot demote yourself; banned users cannot
 * be promoted; users holding an AdminRole row must be revoked via
 * /api/admin/roles.
 *
 * @openapi
 * /api/admin/admins/{userId}:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Promote/demote admin
 *     description: Promotes user to admin or demotes admin to user (super admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to promote/demote
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [promote, demote]
 *     responses:
 *       200:
 *         description: Action completed successfully
 *       400:
 *         description: Cannot demote yourself, invalid action, banned promotion, or target holds an AdminRole
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Super admin access required
 *       404:
 *         description: User not found
 *
 * @example
 * ```typescript
 * await fetch(`/api/admin/admins/${userId}`, {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` },
 *   body: JSON.stringify({ action: 'promote' })
 * });
 * ```
 */

import {
  BusinessLogicError,
  getClientIp,
  logAdminAction,
  NotFoundError,
  requireSuperAdmin,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { adminRoles, and, db, eq, isNull } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

const AdminActionSchema = z.object({
  action: z.enum(['promote', 'demote']),
});

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ userId: string }> }
  ) => {
    // Privilege changes are SUPER_ADMIN-only (same authority as
    // /api/admin/roles); any admin promoting others is a privilege escalation.
    const adminUser = await requireSuperAdmin(request);

    // Parse params
    const { userId } = await context.params;

    // Parse request body
    const body = await request.json();
    const { action } = AdminActionSchema.parse(body);

    logger.info(
      `Admin ${action} request`,
      {
        adminUserId: adminUser.userId,
        targetUserId: userId,
        action,
      },
      'POST /api/admin/admins/[userId]'
    );

    // Get target user
    const targetUser = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActor: true,
        isAdmin: true,
        isBanned: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundError('User', userId);
    }

    // Prevent modifying NPC/actors
    if (targetUser.isActor) {
      throw new BusinessLogicError(
        'Cannot modify admin status of game actors',
        'CANNOT_MODIFY_ACTOR'
      );
    }

    // Banned users cannot be promoted (demoting them is always allowed)
    if (action === 'promote' && targetUser.isBanned) {
      throw new BusinessLogicError(
        'Cannot promote banned users',
        'USER_BANNED'
      );
    }

    // Validate action makes sense
    if (action === 'promote' && targetUser.isAdmin) {
      throw new BusinessLogicError('User is already an admin', 'ALREADY_ADMIN');
    }

    if (action === 'demote' && !targetUser.isAdmin) {
      throw new BusinessLogicError('User is not an admin', 'NOT_ADMIN');
    }

    // Prevent demoting yourself
    if (action === 'demote' && targetUser.id === adminUser.userId) {
      throw new BusinessLogicError(
        'Cannot demote yourself',
        'CANNOT_DEMOTE_SELF'
      );
    }

    // Users with an active AdminRole row keep that role even if the legacy
    // isAdmin flag is cleared, so demoting here would report success without
    // removing access. Role holders must be revoked via /api/admin/roles,
    // which enforces the last-super-admin invariant.
    if (action === 'demote') {
      const [activeRole] = await db
        .select({ role: adminRoles.role })
        .from(adminRoles)
        .where(and(eq(adminRoles.userId, userId), isNull(adminRoles.revokedAt)))
        .limit(1);
      if (activeRole) {
        throw new BusinessLogicError(
          `User holds the ${activeRole.role} role; revoke it via role management`,
          'HAS_ADMIN_ROLE'
        );
      }
    }

    // Update user admin status
    const updatedUser = await db.user.update({
      where: { id: userId },
      data: {
        isAdmin: action === 'promote',
        updatedAt: new Date(),
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        walletAddress: true,
        profileImageUrl: true,
        isAdmin: true,
        hasTwitter: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    logger.info(
      `User ${action}d successfully`,
      {
        adminUserId: adminUser.userId,
        targetUserId: userId,
        targetUsername: updatedUser.username,
        action,
      },
      'POST /api/admin/admins/[userId]'
    );

    // Audit log the privilege change (persist to database)
    // This is a critical security operation that MUST be logged
    await logAdminAction(
      action === 'promote' ? 'PROMOTE_ADMIN' : 'DEMOTE_ADMIN',
      {
        adminId: adminUser.userId,
        ipAddress: getClientIp(request.headers) ?? undefined,
        resourceType: 'user',
        resourceId: userId,
        previousValue: {
          isAdmin: targetUser.isAdmin,
        },
        newValue: {
          isAdmin: action === 'promote',
        },
        metadata: {
          targetUsername: updatedUser.username,
          action,
        },
      }
    ).catch((err) => {
      logger.error(
        'Failed to persist critical audit log for privilege change',
        { err, userId, action },
        'POST /api/admin/admins/[userId]'
      );
    });

    return successResponse({
      message: `User ${action}d successfully`,
      user: updatedUser,
      action,
    });
  }
);
