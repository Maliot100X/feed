import {
  authenticate,
  InternalServerError,
  NotFoundError,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { db, eq, users } from '@feed/db';
import {
  DEFAULT_NOTIFICATION_DIGEST_SETTINGS,
  logger,
  type NotificationDigestSettings,
} from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getMissingNotificationSchemaErrorCode } from '../schema-compat';

const DigestSettingsSchema = z.object({
  digestEnabled: z.boolean(),
  frequency: z.enum(['hourly', 'daily', 'weekly']),
  deliveryChannel: z.enum(['in-app', 'email', 'both']),
});

const digestColumns = {
  notificationDigestEnabled: users.notificationDigestEnabled,
  notificationDigestFrequency: users.notificationDigestFrequency,
  notificationDigestDeliveryChannel: users.notificationDigestDeliveryChannel,
};

/** Validates stored enum strings instead of casting them. */
function toSettings(row: {
  notificationDigestEnabled: boolean;
  notificationDigestFrequency: string;
  notificationDigestDeliveryChannel: string;
}): NotificationDigestSettings {
  const parsed = DigestSettingsSchema.safeParse({
    digestEnabled: row.notificationDigestEnabled,
    frequency: row.notificationDigestFrequency,
    deliveryChannel: row.notificationDigestDeliveryChannel,
  });
  if (!parsed.success) {
    throw new InternalServerError('Stored digest settings are invalid');
  }
  return parsed.data;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const authUser = await authenticate(request);

  try {
    const [user] = await db
      .select(digestColumns)
      .from(users)
      .where(eq(users.id, authUser.userId))
      .limit(1);

    if (!user) {
      throw new NotFoundError('User');
    }

    return successResponse({
      success: true,
      settings: toSettings(user),
    });
  } catch (error) {
    const missingSchemaCode = getMissingNotificationSchemaErrorCode(error);
    if (!missingSchemaCode) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      'Notification digest settings unavailable because the database schema is pending',
      { userId: authUser.userId, code: missingSchemaCode, errorMessage },
      'GET /api/notifications/digest-settings'
    );

    return successResponse({
      success: true,
      settings: DEFAULT_NOTIFICATION_DIGEST_SETTINGS,
    });
  }
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const authUser = await authenticate(request);
  const payload = DigestSettingsSchema.parse(await request.json());

  const [current] = await db
    .select(digestColumns)
    .from(users)
    .where(eq(users.id, authUser.userId))
    .limit(1);
  if (!current) {
    throw new NotFoundError('User');
  }

  // Only reset the delivery checkpoint when the schedule actually changes, so
  // repeated idempotent PUTs cannot force extra digests.
  const scheduleChanged =
    current.notificationDigestEnabled !== payload.digestEnabled ||
    current.notificationDigestFrequency !== payload.frequency;

  const [updated] = await db
    .update(users)
    .set({
      notificationDigestEnabled: payload.digestEnabled,
      notificationDigestFrequency: payload.frequency,
      notificationDigestDeliveryChannel: payload.deliveryChannel,
      ...(scheduleChanged ? { notificationDigestLastSentAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, authUser.userId))
    .returning(digestColumns);

  if (!updated) {
    throw new NotFoundError('User');
  }

  return successResponse({
    success: true,
    settings: toSettings(updated),
  });
});
