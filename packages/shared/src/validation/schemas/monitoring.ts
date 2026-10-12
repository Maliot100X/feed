/**
 * Monitoring and SSE-related validation schemas
 */

import { z } from 'zod';
import {
  createQueryBooleanSchema,
  OptionalQueryBooleanSchema,
  PaginationSchema,
  SnowflakeIdSchema,
} from './common';

/**
 * SSE channel schema
 */
export const SSEChannelSchema = z.enum([
  'feed',
  'markets',
  'breaking-news',
  'upcoming-events',
]);

/**
 * SSE channels query parameter
 */
export const SSEChannelsQuerySchema = z.object({
  channels: z.string().optional(), // Comma-separated list
  token: z.string().min(1),
});

/**
 * Cache monitoring query schema
 */
export const CacheMonitoringQuerySchema = z.object({
  includeDetails: OptionalQueryBooleanSchema,
});

/**
 * Notifications query schema
 */
export const NotificationsQuerySchema = PaginationSchema.extend({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: createQueryBooleanSchema(false),
  type: z.string().max(64).optional(),
});

/**
 * Mark notifications as read schema
 */
export const MarkNotificationsReadSchema = z
  .object({
    notificationIds: z.array(SnowflakeIdSchema).max(500).optional(),
    markAllAsRead: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.markAllAsRead === true ||
      (data.notificationIds && data.notificationIds.length > 0),
    {
      message:
        'Either markAllAsRead must be true or notificationIds array must be provided',
    }
  );
