/**
 * Admin Whitelist Management API
 *
 * @route GET /api/admin/whitelist - List whitelisted users with stats
 * @route POST /api/admin/whitelist - Add a user to the whitelist
 * @route DELETE /api/admin/whitelist - Remove (revoke) a user from the whitelist
 * @access Admin
 */

import { requireAdmin, successResponse, withErrorHandling } from '@feed/api';
import {
  addToWhitelist,
  getWhitelistStats,
  listWhitelistEntries,
  removeFromWhitelist,
} from '@feed/api/services/whitelist-service';
import { db, eq, sql, users } from '@feed/db';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ListQuerySchema = z.object({
  source: z
    .enum(['snapshot_first_100', 'admin_manual', 'leaderboard'])
    .optional(),
  search: z.string().trim().min(1).max(100).optional(),
  includeRevoked: z.enum(['true', 'false']).default('false'),
});

const AddSchema = z.object({
  userId: z.string().trim().min(1, 'userId is required').max(100),
  // Admin additions are always recorded as admin_manual; other sources are
  // written by their own automated flows and must not be spoofed here.
  source: z.literal('admin_manual').optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

const RemoveSchema = z.object({
  userId: z.string().trim().min(1, 'userId is required').max(100),
});

function badRequest(error: z.ZodError) {
  return NextResponse.json(
    { error: error.issues[0]?.message ?? 'Invalid request' },
    { status: 400 }
  );
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const { searchParams } = new URL(request.url);
  const parsed = ListQuerySchema.safeParse({
    source: searchParams.get('source') ?? undefined,
    search: searchParams.get('search') || undefined,
    includeRevoked: searchParams.get('includeRevoked') ?? undefined,
  });
  if (!parsed.success) return badRequest(parsed.error);
  const { source, search, includeRevoked } = parsed.data;

  const [entries, stats] = await Promise.all([
    listWhitelistEntries({
      source,
      search,
      includeRevoked: includeRevoked === 'true',
    }),
    getWhitelistStats(),
  ]);

  return successResponse({ entries, stats });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const admin = await requireAdmin(request);

  const parsed = AddSchema.safeParse(await request.json());
  if (!parsed.success) return badRequest(parsed.error);
  const { userId, reason } = parsed.data;

  // Strip leading @ and resolve deterministically: exact user id first, then
  // case-insensitive username (rejecting ambiguous username matches).
  const identifier = userId.replace(/^@/, '');

  const [byId] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, identifier))
    .limit(1);

  let user = byId;
  if (!user) {
    const byUsername = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${identifier})`)
      .limit(2);
    if (byUsername.length > 1) {
      return NextResponse.json(
        { error: 'Username matches multiple users; use the user id' },
        { status: 409 }
      );
    }
    user = byUsername[0];
  }

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const result = await addToWhitelist({
    userId: user.id,
    source: 'admin_manual',
    reason,
    grantedBy: admin.dbUserId ?? undefined,
  });

  if (result.alreadyExists) {
    return NextResponse.json(
      { error: 'User is already whitelisted' },
      { status: 409 }
    );
  }

  return successResponse({
    success: true,
    id: result.id,
    username: user.username,
  });
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const parsed = RemoveSchema.safeParse(await request.json());
  if (!parsed.success) return badRequest(parsed.error);
  const { userId } = parsed.data;

  const result = await removeFromWhitelist(userId);

  if (!result.removed) {
    return NextResponse.json(
      { error: 'User not found in whitelist or already revoked' },
      { status: 404 }
    );
  }

  return successResponse({ success: true, removedUserId: userId });
});
