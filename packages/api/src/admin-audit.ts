/**
 * Admin Audit Logger
 *
 * @description Logs admin actions for audit trail and debugging purposes.
 * All admin API operations should log their actions through this utility.
 * Actions are logged to both the console (for immediate visibility) and
 * the AdminAuditLog database table (for persistence and reporting).
 */

import { adminAuditLogs, db } from '@feed/db';
import { generateSnowflakeId, logger } from '@feed/shared';
import type { JsonValue } from './types';

export interface AdminAuditContext {
  /** Admin user ID performing the action */
  adminId: string;
  /** IP address of the request (if available) */
  ipAddress?: string;
  /** User agent of the request (if available) */
  userAgent?: string;
  /** Target resource type (e.g., 'group', 'user', 'message') */
  resourceType: string;
  /** Target resource ID */
  resourceId?: string;
  /** Previous value before modification */
  previousValue?: JsonValue;
  /** New value after modification */
  newValue?: JsonValue;
  /** Additional context data - must be JSON-serializable */
  metadata?: JsonValue;
}

/**
 * Log an admin action for audit purposes.
 * Logs to both console and database for redundancy.
 */
export async function logAdminAction(
  action: string,
  context: AdminAuditContext
): Promise<void> {
  const timestamp = new Date().toISOString();

  // Log to console immediately
  logger.info(
    `[ADMIN_AUDIT] ${action}`,
    {
      action,
      adminId: context.adminId,
      ipAddress: context.ipAddress,
      resourceType: context.resourceType,
      resourceId: context.resourceId,
      timestamp,
    },
    'AdminAudit'
  );

  // Await persistence so the record is written before the response
  // completes (request-scoped runtimes may drop work after the response).
  await persistAuditLog(action, context);
}

/**
 * Persist audit log to database.
 *
 * A persistence failure is logged and does not fail the admin operation
 * (which has already been applied); the console log above remains.
 */
async function persistAuditLog(
  action: string,
  context: AdminAuditContext
): Promise<void> {
  try {
    const id = await generateSnowflakeId();
    await db.insert(adminAuditLogs).values({
      id,
      adminId: context.adminId,
      action,
      resourceType: context.resourceType,
      resourceId: context.resourceId ?? null,
      previousValue: context.previousValue ?? null,
      newValue: context.newValue ?? null,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      metadata: context.metadata ?? null,
    });
  } catch (error) {
    logger.error(
      'Failed to persist admin audit log',
      {
        action,
        adminId: context.adminId,
        resourceType: context.resourceType,
        resourceId: context.resourceId,
        error: error instanceof Error ? error.message : String(error),
      },
      'AdminAudit'
    );
  }
}

/**
 * Log admin viewing/reading a resource
 */
export async function logAdminView(context: AdminAuditContext): Promise<void> {
  await logAdminAction('VIEW', context);
}

/**
 * Log admin modifying a resource
 */
export async function logAdminModify(
  context: AdminAuditContext
): Promise<void> {
  await logAdminAction('MODIFY', context);
}

/**
 * Log admin deleting a resource
 */
export async function logAdminDelete(
  context: AdminAuditContext
): Promise<void> {
  await logAdminAction('DELETE', context);
}

/**
 * Log admin creating a resource
 */
export async function logAdminCreate(
  context: AdminAuditContext
): Promise<void> {
  await logAdminAction('CREATE', context);
}

/**
 * Log admin ban/unban action
 */
export async function logAdminBan(
  context: AdminAuditContext & { isBan: boolean }
): Promise<void> {
  await logAdminAction(context.isBan ? 'BAN' : 'UNBAN', context);
}

/**
 * Log admin promoting/demoting another admin
 */
export async function logAdminPrivilegeChange(
  context: AdminAuditContext & { isPromotion: boolean }
): Promise<void> {
  await logAdminAction(
    context.isPromotion ? 'PROMOTE_ADMIN' : 'DEMOTE_ADMIN',
    context
  );
}

// Re-export getClientIp from utils for convenience
export { getClientIp } from './utils';
