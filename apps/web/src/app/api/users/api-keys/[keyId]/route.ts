/**
 * Delete User API Key
 *
 * @route DELETE /api/users/api-keys/[keyId] - Revoke API key
 * @access Authenticated (own keys only)
 */

import {
  authenticate,
  invalidateCachedKey,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { and, asUser, eq, isNull, userApiKeys } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * DELETE /api/users/api-keys/[keyId] - Revoke API key
 */
export const DELETE = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ keyId: string }> }
  ) => {
    const authUser = await authenticate(request);
    const { keyId } = await context.params;

    // Use asUser to enforce RLS - user can only revoke their own keys
    // Single conditional update: owner + still-active predicates are part of
    // the write, so concurrent revokes cannot both succeed.
    const deleted = await asUser(authUser.userId, async (dbClient) =>
      dbClient
        .update(userApiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userApiKeys.id, keyId),
            eq(userApiKeys.userId, authUser.userId),
            isNull(userApiKeys.revokedAt)
          )
        )
        .returning({ keyHash: userApiKeys.keyHash })
    );

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 }
      );
    }

    // Immediately invalidate cached key to prevent continued use
    const revokedKey = deleted[0];
    if (revokedKey?.keyHash) {
      invalidateCachedKey(revokedKey.keyHash);
    }

    logger.info(
      'API key revoked',
      { userId: authUser.userId, keyId },
      'API Keys'
    );

    return successResponse({
      message: 'API key revoked successfully',
    });
  }
);
