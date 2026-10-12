/**
 * logAdminAction must have persisted the audit row when its promise resolves.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { logAdminAction } from '@feed/api';
import { adminAuditLogs, db, eq } from '@feed/db';

const adminId = `audit-test-${crypto.randomUUID()}`;

describe('admin audit persistence', () => {
  afterAll(async () => {
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.adminId, adminId));
  });

  it('writes the audit row before resolving', async () => {
    await logAdminAction('BAN', {
      adminId,
      resourceType: 'user',
      resourceId: 'target-user',
      newValue: { isBanned: true },
    });

    const rows = await db
      .select({
        action: adminAuditLogs.action,
        resourceId: adminAuditLogs.resourceId,
      })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.adminId, adminId));
    expect(rows).toEqual([{ action: 'BAN', resourceId: 'target-user' }]);
  });
});
