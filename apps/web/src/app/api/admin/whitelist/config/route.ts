/**
 * Admin Whitelist Config API
 *
 * @route GET /api/admin/whitelist/config - Get current whitelist configuration
 * @route PUT /api/admin/whitelist/config - Update whitelist configuration
 * @access Admin
 */

import { requireAdmin, successResponse, withErrorHandling } from '@feed/api';
import {
  getWhitelistConfig,
  updateWhitelistConfig,
} from '@feed/api/services/whitelist-service';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ConfigSchema = z.object({
  leaderboardRankThreshold: z
    .number({ message: 'leaderboardRankThreshold must be a positive integer' })
    .int('leaderboardRankThreshold must be a positive integer')
    .min(1, 'leaderboardRankThreshold must be a positive integer')
    .max(1_000_000, 'leaderboardRankThreshold must be at most 1000000'),
  leaderboardCategory: z
    .enum(['all', 'trading', 'social', 'reputation'], {
      message:
        'leaderboardCategory must be one of: all, trading, social, reputation',
    })
    .optional(),
});

export const GET = withErrorHandling(async (request: NextRequest) => {
  await requireAdmin(request);

  const config = await getWhitelistConfig();

  return successResponse({
    config: config
      ? {
          ...config,
          leaderboardRankThreshold: config.leaderboardRankThreshold ?? 100,
        }
      : {
          leaderboardRankThreshold: 100,
          leaderboardCategory: 'all',
          updatedAt: null,
          updatedBy: null,
        },
  });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const admin = await requireAdmin(request);

  const parsed = ConfigSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }
  const { leaderboardRankThreshold, leaderboardCategory } = parsed.data;

  await updateWhitelistConfig({
    leaderboardRankThreshold,
    leaderboardCategory,
    updatedBy: admin.dbUserId ?? undefined,
  });

  const config = await getWhitelistConfig();

  return successResponse({ success: true, config });
});
