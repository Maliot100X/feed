/**
 * Group Invite Decline API
 *
 * @route POST /api/groups/invites/[inviteId]/decline - Decline group invite
 * @access Authenticated
 */

import {
  authenticate,
  declineGroupInvite,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';

/**
 * POST /api/groups/invites/[inviteId]/decline
 * Decline a group invitation
 */
export const POST = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ inviteId: string }> }
  ) => {
    const user = await authenticate(request);
    const { inviteId } = await params;

    await declineGroupInvite(user.userId, inviteId);

    logger.info(
      'Group invite declined',
      { userId: user.userId, inviteId },
      'POST /api/groups/invites/:inviteId/decline'
    );

    return successResponse({ success: true });
  }
);
