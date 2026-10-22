/**
 * Push Notification Device Registration API
 *
 * @route POST /api/notifications/register-device
 * @access Authenticated users only
 *
 * @description
 * Stores a push notification device token (APNs or FCM) for the
 * authenticated user. Called by the Capacitor mobile app after
 * receiving a push token from the OS.
 *
 * Device tokens use shared storage with a TTL of 90 days.
 * Each user can have multiple device tokens (multiple devices).
 *
 * @body { platform: 'ios' | 'android', token: string }
 */

import { authenticate, getDeviceRegistry, withErrorHandling } from '@feed/api';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const RegisterDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  token: z.string().min(1).max(4096),
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const authUser = await authenticate(request);
  const userId = authUser.dbUserId ?? authUser.userId;

  const parsed = RegisterDeviceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'Invalid body: platform must be "ios" or "android" and token a non-empty string',
      },
      { status: 400 }
    );
  }
  const { platform, token } = parsed.data;

  const registry = getDeviceRegistry();
  if (!registry) {
    return NextResponse.json(
      { error: 'Push notification service unavailable' },
      { status: 503 }
    );
  }

  await registry.register({ userId, platform, token });

  return NextResponse.json({ success: true });
});
