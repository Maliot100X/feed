/**
 * Push Notification Device Unregistration API
 *
 * @route POST /api/notifications/unregister-device
 * @access Authenticated users only
 *
 * @description
 * Removes all push notification device tokens for the authenticated user.
 * Called by the mobile app on logout. Intentionally removes all devices
 * (not per-platform) — logout should silence push across all sessions.
 */

import { authenticate, getDeviceRegistry, withErrorHandling } from '@feed/api';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const POST = withErrorHandling(async (request: NextRequest) => {
  const authUser = await authenticate(request);
  const userId = authUser.dbUserId ?? authUser.userId;

  const registry = getDeviceRegistry();
  if (!registry) {
    return NextResponse.json(
      { error: 'Push notification service unavailable' },
      { status: 503 }
    );
  }

  await registry.remove(userId);

  return NextResponse.json({ success: true });
});
