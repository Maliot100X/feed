// GET /api/admin/roles - List admins
// POST /api/admin/roles - Grant/revoke roles (SUPER_ADMIN only)

import {
  applyRateLimit,
  errorResponse,
  getAllAdmins,
  RATE_LIMIT_CONFIGS,
  rateLimitError,
  requireAdmin,
  requireSuperAdmin,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  type AdminPermission,
  adminRoles,
  and,
  db,
  eq,
  generateSnowflakeId,
  isNull,
  ROLE_PERMISSIONS,
  users,
} from '@feed/db';
import { logger, toISO } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

/**
 * Zod schema for role grant/revoke request validation
 *
 * Uses the canonical ADMIN_ROLES and ADMIN_PERMISSIONS constants from @feed/db
 * to ensure validation stays in sync with the database schema.
 */
const RoleRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  action: z.enum(['grant', 'revoke']),
  role: z.enum(ADMIN_ROLES).optional(),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)).optional(),
});

/**
 * Custom error class for role operations that need to be caught
 * and converted to proper API responses
 */
class RoleOperationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'RoleOperationError';
  }
}

type RoleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Throws LAST_SUPER_ADMIN when `userId` is currently the only active
 * SUPER_ADMIN. Locks every active SUPER_ADMIN row (FOR UPDATE cannot be
 * combined with an aggregate in Postgres) so concurrent revocations or
 * downgrades serialize on the same rows.
 */
async function assertNotLastSuperAdmin(
  tx: RoleTransaction,
  userId: string
): Promise<void> {
  const activeSuperAdmins = await tx
    .select({ userId: adminRoles.userId })
    .from(adminRoles)
    .where(
      and(eq(adminRoles.role, 'SUPER_ADMIN'), isNull(adminRoles.revokedAt))
    )
    .for('update');

  const targetIsSuperAdmin = activeSuperAdmins.some(
    (row) => row.userId === userId
  );
  if (targetIsSuperAdmin && activeSuperAdmins.length <= 1) {
    throw new RoleOperationError(
      'Cannot remove the last super admin',
      'LAST_SUPER_ADMIN',
      400
    );
  }
}

/** Runs a role mutation, mapping expected RoleOperationErrors to responses. */
async function runRoleOperation(
  operation: () => Promise<void>
): Promise<Response | null> {
  try {
    await operation();
    return null;
  } catch (error) {
    if (error instanceof RoleOperationError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    throw error;
  }
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const admins = await getAllAdmins();

  return successResponse({
    admins: admins.map((admin) => ({
      userId: admin.userId,
      username: admin.username,
      displayName: admin.displayName,
      profileImageUrl: admin.profileImageUrl,
      role: admin.role,
      permissions: admin.permissions,
      grantedAt: toISO(admin.grantedAt),
      grantedBy: admin.grantedBy,
    })),
    total: admins.length,
  });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const admin = await requireSuperAdmin(request);

  // Rate limit role management to prevent abuse
  const rateLimitResult = await applyRateLimit(
    admin.userId,
    RATE_LIMIT_CONFIGS.ADMIN_ACTION
  );
  if (!rateLimitResult.allowed) {
    return rateLimitError(rateLimitResult.retryAfter);
  }

  const body = await request.json();

  // Validate request body with Zod
  const parseResult = RoleRequestSchema.safeParse(body);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    return errorResponse(
      firstIssue?.message ?? 'Invalid request body',
      'VALIDATION_ERROR',
      400
    );
  }

  const { userId, action, role, permissions } = parseResult.data;

  const [targetUser] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!targetUser) {
    return errorResponse('User not found', 'USER_NOT_FOUND', 404);
  }

  if (action === 'grant') {
    if (!role) {
      return errorResponse(
        `Valid role is required. Must be one of: ${ADMIN_ROLES.join(', ')}`,
        'INVALID_ROLE',
        400
      );
    }

    // Get default permissions for the role
    const roleDefaultPermissions = ROLE_PERMISSIONS[role];

    // If custom permissions provided, validate they are a subset of role's allowed permissions
    if (permissions) {
      const invalidPermissions = permissions.filter(
        (p) => !roleDefaultPermissions.includes(p)
      );
      if (invalidPermissions.length > 0) {
        return errorResponse(
          `Custom permissions must be a subset of ${role} permissions. Invalid: ${invalidPermissions.join(', ')}`,
          'INVALID_PERMISSIONS',
          400
        );
      }
    }

    const finalPermissions: AdminPermission[] =
      permissions ?? roleDefaultPermissions;
    const now = new Date();
    // generateSnowflakeId is async; resolve before building the row so the id
    // is a real snowflake rather than the string "[object Promise]".
    const roleId = `admin_role_${await generateSnowflakeId()}`;

    // Use transaction to ensure atomic role grant + isAdmin flag update
    const grantError = await runRoleOperation(() =>
      db.transaction(async (tx) => {
        // Downgrading a SUPER_ADMIN must not remove the last one.
        if (role !== 'SUPER_ADMIN') {
          await assertNotLastSuperAdmin(tx, userId);
        }

        // Use upsert (onConflictDoUpdate) to prevent race conditions
        await tx
          .insert(adminRoles)
          .values({
            id: roleId,
            userId,
            role,
            permissions: finalPermissions,
            grantedBy: admin.userId,
            grantedAt: now,
          })
          .onConflictDoUpdate({
            target: adminRoles.userId,
            set: {
              role,
              permissions: finalPermissions,
              grantedBy: admin.userId,
              grantedAt: now,
              revokedAt: null,
            },
          });

        // Update legacy isAdmin flag for backward compatibility (atomic with role grant)
        await tx
          .update(users)
          .set({ isAdmin: true })
          .where(eq(users.id, userId));
      })
    );
    if (grantError) return grantError;

    logger.info(
      'Admin role granted/updated',
      { targetUserId: userId, role, grantedBy: admin.userId },
      'POST /api/admin/roles'
    );

    return successResponse({
      success: true,
      message: `${role} role granted to user`,
      user: {
        userId,
        username: targetUser.username,
        displayName: targetUser.displayName,
        role,
        permissions: finalPermissions,
      },
    });
  }

  if (admin.userId === userId) {
    return errorResponse(
      'Cannot revoke your own admin role',
      'CANNOT_REVOKE_SELF',
      400
    );
  }

  const revokeError = await runRoleOperation(() =>
    db.transaction(async (tx) => {
      // Read the active role inside the transaction (locked) so the
      // last-super-admin check below sees committed state.
      const [existingRole] = await tx
        .select({ role: adminRoles.role })
        .from(adminRoles)
        .where(and(eq(adminRoles.userId, userId), isNull(adminRoles.revokedAt)))
        .limit(1)
        .for('update');

      if (!existingRole) {
        throw new RoleOperationError(
          'User does not have an active admin role',
          'NO_ACTIVE_ROLE',
          400
        );
      }

      await assertNotLastSuperAdmin(tx, userId);

      await tx
        .update(adminRoles)
        .set({ revokedAt: new Date() })
        .where(eq(adminRoles.userId, userId));

      await tx
        .update(users)
        .set({ isAdmin: false })
        .where(eq(users.id, userId));
    })
  );
  if (revokeError) return revokeError;

  logger.info(
    'Admin role revoked',
    { targetUserId: userId, revokedBy: admin.userId },
    'POST /api/admin/roles'
  );

  return successResponse({
    success: true,
    message: 'Admin role revoked',
    user: {
      userId,
      username: targetUser.username,
      displayName: targetUser.displayName,
    },
  });
});
