/**
 * Alpha Groups Configuration API
 *
 * @route GET /api/admin/alpha-groups/config - Get current configuration
 * @route PATCH /api/admin/alpha-groups/config - Preview configuration changes
 * @access Admin with manage_alpha_groups permission
 *
 * @description
 * Returns the current alpha group configuration including all thresholds,
 * probabilities, and feature flags. The PATCH endpoint previews what
 * changes would be applied (actual changes require env var updates).
 */

import {
  requirePermission,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import {
  ALPHA_GROUP_CONFIG,
  DOMAIN_FOCUS_WEIGHTS,
  TIER_CONFIG,
} from '@feed/engine';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

type AlphaConfigKey = keyof typeof ALPHA_GROUP_CONFIG;

/**
 * Configuration value descriptions for documentation. Typed against the
 * engine config so every key must be described (no silent gaps).
 */
const CONFIG_DESCRIPTIONS: Record<AlphaConfigKey, string> = {
  inviteProbabilityMultiplier:
    'Global multiplier for all tier invite probabilities (1.0 = default)',
  maxInvitesPerTick: 'Maximum invites sent per game tick across all NPCs',
  topUsersToConsider:
    'Number of top engaged users to evaluate per NPC per tick',
  minReplies: 'Minimum replies to NPC posts required for eligibility',
  minLikes: 'Minimum likes on NPC posts required for eligibility',
  minTotalInteractions: 'Minimum total interactions (replies + likes + shares)',
  minQualityScore: 'Minimum quality score for replies (0-1 scale)',
  maxInteractionsPerDay: 'Maximum interactions per day before spam detection',
  tradeWeight: 'Points per trade in engagement score calculation',
  profitableTradeBonus: 'Extra points for profitable trades',
  includeTradingActivity: 'Whether trading activity affects engagement score',
  fastTrackEnabled: 'Allow high-value traders to skip Tier 3',
  fastTrackMinTrades: 'Minimum trades required for fast-track eligibility',
  fastTrackMinPnL: 'Minimum cumulative P&L required for fast-track',
  fastTrackMinWinRate: 'Minimum win rate (0-1) for fast-track eligibility',
  fastTrackTargetTier: 'Tier to fast-track qualified users to (2 or 3)',
  inviteDecayEnabled: 'Enable exponential backoff for users who decline',
  inviteDecayBaseHours: 'Base cooldown hours after first decline',
  inviteDecayMaxHours: 'Maximum cooldown hours (cap for exponential backoff)',
  inviteDecayMaxDeclines: 'Maximum declines before temporary exclusion',
  inviteDecayResetDays: 'Days of inactivity before decline count resets',
  inviteCooldownHours: 'Hours after joining before eligible for next invite',
  maxInvitesPerUserPerWeek:
    'Maximum invites a single user can receive per week (across all NPCs)',
  requireRecentActivity: 'Require recent activity for invite eligibility',
  recentActivityDays: 'Days to look back for recent activity',
  tieredInviteProbability:
    'Invite probability per eligible user per tick in the tiered system',
  inviteUserChance:
    'User invite chance per group per tick for NPC group dynamics',
  perNpcCustomizationEnabled: 'Enable per-NPC tier threshold customization',
  grandfatheringEnabled: 'Protect existing members during threshold changes',
  replyWeight: 'Weight for replies in engagement score calculation',
  likeWeight: 'Weight for likes in engagement score calculation',
  shareWeight: 'Weight for shares in engagement score calculation',
  maxExpectedSocialScore: 'Normalization factor for social score (max raw)',
  maxExpectedTradingScore: 'Normalization factor for trading score (max raw)',
  qualityMultiplier: 'Bonus multiplier for high-quality replies',
  qualityThreshold: 'Quality score threshold for applying bonus multiplier',
  defaultSocialWeight: 'Default weight for social interactions (0-1)',
  defaultTradingWeight: 'Default weight for trading activity (0-1)',
};

/**
 * Environment variable names for each config key (must match
 * packages/engine/src/config/alpha-group-config.ts).
 */
const CONFIG_ENV_VARS: Record<AlphaConfigKey, string> = {
  inviteProbabilityMultiplier: 'ALPHA_INVITE_PROBABILITY_MULTIPLIER',
  maxInvitesPerTick: 'ALPHA_MAX_INVITES_PER_TICK',
  topUsersToConsider: 'ALPHA_TOP_USERS_TO_CONSIDER',
  minReplies: 'ALPHA_MIN_REPLIES',
  minLikes: 'ALPHA_MIN_LIKES',
  minTotalInteractions: 'ALPHA_MIN_TOTAL_INTERACTIONS',
  minQualityScore: 'ALPHA_MIN_QUALITY_SCORE',
  maxInteractionsPerDay: 'ALPHA_MAX_INTERACTIONS_PER_DAY',
  tradeWeight: 'ALPHA_TRADE_WEIGHT',
  profitableTradeBonus: 'ALPHA_PROFITABLE_TRADE_BONUS',
  includeTradingActivity: 'ALPHA_INCLUDE_TRADING',
  fastTrackEnabled: 'ALPHA_FAST_TRACK_ENABLED',
  fastTrackMinTrades: 'ALPHA_FAST_TRACK_MIN_TRADES',
  fastTrackMinPnL: 'ALPHA_FAST_TRACK_MIN_PNL',
  fastTrackMinWinRate: 'ALPHA_FAST_TRACK_MIN_WIN_RATE',
  fastTrackTargetTier: 'ALPHA_FAST_TRACK_TARGET_TIER',
  inviteDecayEnabled: 'ALPHA_INVITE_DECAY_ENABLED',
  inviteDecayBaseHours: 'ALPHA_INVITE_DECAY_BASE_HOURS',
  inviteDecayMaxHours: 'ALPHA_INVITE_DECAY_MAX_HOURS',
  inviteDecayMaxDeclines: 'ALPHA_INVITE_DECAY_MAX_DECLINES',
  inviteDecayResetDays: 'ALPHA_INVITE_DECAY_RESET_DAYS',
  inviteCooldownHours: 'ALPHA_INVITE_COOLDOWN_HOURS',
  maxInvitesPerUserPerWeek: 'ALPHA_MAX_INVITES_PER_USER_PER_WEEK',
  requireRecentActivity: 'ALPHA_REQUIRE_RECENT_ACTIVITY',
  recentActivityDays: 'ALPHA_RECENT_ACTIVITY_DAYS',
  tieredInviteProbability: 'ALPHA_TIERED_INVITE_PROBABILITY',
  inviteUserChance: 'ALPHA_INVITE_USER_CHANCE',
  perNpcCustomizationEnabled: 'ALPHA_PER_NPC_CUSTOMIZATION_ENABLED',
  grandfatheringEnabled: 'ALPHA_GRANDFATHERING_ENABLED',
  replyWeight: 'ALPHA_REPLY_WEIGHT',
  likeWeight: 'ALPHA_LIKE_WEIGHT',
  shareWeight: 'ALPHA_SHARE_WEIGHT',
  maxExpectedSocialScore: 'ALPHA_MAX_EXPECTED_SOCIAL_SCORE',
  maxExpectedTradingScore: 'ALPHA_MAX_EXPECTED_TRADING_SCORE',
  qualityMultiplier: 'ALPHA_QUALITY_MULTIPLIER',
  qualityThreshold: 'ALPHA_QUALITY_THRESHOLD',
  defaultSocialWeight: 'ALPHA_DEFAULT_SOCIAL_WEIGHT',
  defaultTradingWeight: 'ALPHA_DEFAULT_TRADING_WEIGHT',
};

/**
 * GET /api/admin/alpha-groups/config
 *
 * Returns the current alpha group configuration with descriptions
 * and tier-specific settings.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  await requirePermission(request, 'view_alpha_groups');

  logger.info(
    'Alpha group config requested',
    {},
    'GET /api/admin/alpha-groups/config'
  );

  // Build config response with metadata
  const configWithMeta = (
    Object.keys(ALPHA_GROUP_CONFIG) as AlphaConfigKey[]
  ).map((key) => ({
    key,
    value: ALPHA_GROUP_CONFIG[key],
    description: CONFIG_DESCRIPTIONS[key],
    envVar: CONFIG_ENV_VARS[key],
    type: typeof ALPHA_GROUP_CONFIG[key],
  }));

  return successResponse({
    success: true,
    data: {
      config: ALPHA_GROUP_CONFIG,
      configWithMeta,
      tierConfig: {
        1: {
          name: TIER_CONFIG[1].name,
          minEngagementScore: TIER_CONFIG[1].minEngagementScore,
          inviteProbability: TIER_CONFIG[1].inviteProbability,
          maxMembers: TIER_CONFIG[1].maxMembers,
          alphaLevel: TIER_CONFIG[1].alphaLevel,
          promotionWaitDays: TIER_CONFIG[1].promotionWaitDays,
          demotionInactiveDays: TIER_CONFIG[1].demotionInactiveDays,
        },
        2: {
          name: TIER_CONFIG[2].name,
          minEngagementScore: TIER_CONFIG[2].minEngagementScore,
          inviteProbability: TIER_CONFIG[2].inviteProbability,
          maxMembers: TIER_CONFIG[2].maxMembers,
          alphaLevel: TIER_CONFIG[2].alphaLevel,
          promotionWaitDays: TIER_CONFIG[2].promotionWaitDays,
          demotionInactiveDays: TIER_CONFIG[2].demotionInactiveDays,
        },
        3: {
          name: TIER_CONFIG[3].name,
          minEngagementScore: TIER_CONFIG[3].minEngagementScore,
          inviteProbability: TIER_CONFIG[3].inviteProbability,
          maxMembers: TIER_CONFIG[3].maxMembers,
          alphaLevel: TIER_CONFIG[3].alphaLevel,
          promotionWaitDays: TIER_CONFIG[3].promotionWaitDays,
          demotionInactiveDays: TIER_CONFIG[3].demotionInactiveDays,
        },
      },
      domainFocusWeights: DOMAIN_FOCUS_WEIGHTS,
      instructions: {
        howToUpdate:
          'Configuration is controlled via environment variables. Set the corresponding env var and restart the service.',
        effectiveImmediately:
          'Changes take effect on the next game tick after service restart.',
        documentation:
          'Configuration is managed via environment variables prefixed with ALPHA_.',
      },
    },
  });
});

/**
 * Schema for PATCH request body validation.
 */
const ConfigUpdateSchema = z
  .object({
    inviteProbabilityMultiplier: z.number().min(0).max(10).optional(),
    maxInvitesPerTick: z.number().int().min(1).max(100).optional(),
    topUsersToConsider: z.number().int().min(1).max(100).optional(),
    minReplies: z.number().int().min(0).max(100).optional(),
    minLikes: z.number().int().min(0).max(100).optional(),
    minTotalInteractions: z.number().int().min(0).max(500).optional(),
    minQualityScore: z.number().min(0).max(1).optional(),
    maxInteractionsPerDay: z.number().int().min(1).max(1000).optional(),
    tradeWeight: z.number().min(0).max(100).optional(),
    profitableTradeBonus: z.number().min(0).max(100).optional(),
    includeTradingActivity: z.boolean().optional(),
    fastTrackEnabled: z.boolean().optional(),
    fastTrackMinTrades: z.number().int().min(1).max(1000).optional(),
    fastTrackMinPnL: z.number().min(0).optional(),
    fastTrackMinWinRate: z.number().min(0).max(1).optional(),
    inviteDecayEnabled: z.boolean().optional(),
    inviteDecayBaseHours: z.number().int().min(1).max(720).optional(),
    inviteDecayMaxHours: z.number().int().min(1).max(8760).optional(),
    inviteDecayMaxDeclines: z.number().int().min(1).max(100).optional(),
    inviteDecayResetDays: z.number().int().min(1).max(365).optional(),
    inviteCooldownHours: z.number().int().min(0).max(168).optional(),
    maxInvitesPerUserPerWeek: z.number().int().min(1).max(100).optional(),
    requireRecentActivity: z.boolean().optional(),
    recentActivityDays: z.number().int().min(1).max(365).optional(),
    tieredInviteProbability: z.number().min(0).max(1).optional(),
    inviteUserChance: z.number().min(0).max(1).optional(),
    fastTrackTargetTier: z.union([z.literal(2), z.literal(3)]).optional(),
    perNpcCustomizationEnabled: z.boolean().optional(),
    grandfatheringEnabled: z.boolean().optional(),
    replyWeight: z.number().min(0).max(100).optional(),
    likeWeight: z.number().min(0).max(100).optional(),
    shareWeight: z.number().min(0).max(100).optional(),
    maxExpectedSocialScore: z.number().positive().max(100_000).optional(),
    maxExpectedTradingScore: z.number().positive().max(100_000).optional(),
    qualityMultiplier: z.number().min(0).max(10).optional(),
    qualityThreshold: z.number().min(0).max(1).optional(),
    defaultSocialWeight: z.number().min(0).max(1).optional(),
    defaultTradingWeight: z.number().min(0).max(1).optional(),
  })
  // Unknown keys are rejected instead of silently stripped.
  .strict()
  .superRefine((proposed, ctx) => {
    const baseHours =
      proposed.inviteDecayBaseHours ?? ALPHA_GROUP_CONFIG.inviteDecayBaseHours;
    const maxHours =
      proposed.inviteDecayMaxHours ?? ALPHA_GROUP_CONFIG.inviteDecayMaxHours;
    if (maxHours < baseHours) {
      ctx.addIssue({
        code: 'custom',
        path: ['inviteDecayMaxHours'],
        message: 'inviteDecayMaxHours must be >= inviteDecayBaseHours',
      });
    }
    const social =
      proposed.defaultSocialWeight ?? ALPHA_GROUP_CONFIG.defaultSocialWeight;
    const trading =
      proposed.defaultTradingWeight ?? ALPHA_GROUP_CONFIG.defaultTradingWeight;
    // The engine normalizes by social + trading, so the sum must be > 0.
    if (social + trading <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultSocialWeight'],
        message: 'defaultSocialWeight + defaultTradingWeight must be > 0',
      });
    }
  });

/**
 * PATCH /api/admin/alpha-groups/config
 *
 * Preview configuration changes. This endpoint does not actually
 * modify the configuration (which requires env var changes), but
 * validates proposed changes and returns the diff.
 */
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  const admin = await requirePermission(request, 'manage_alpha_groups');

  const body = await request.json();
  const proposed = ConfigUpdateSchema.parse(body);

  logger.info(
    'Alpha group config update preview',
    { adminUserId: admin.userId, proposedChanges: proposed },
    'PATCH /api/admin/alpha-groups/config'
  );

  // Calculate diff
  const changes: Array<{
    key: string;
    currentValue: unknown;
    proposedValue: unknown;
    envVar: string;
  }> = [];

  for (const key of Object.keys(proposed) as (keyof typeof proposed)[]) {
    const proposedValue = proposed[key];
    const currentValue = ALPHA_GROUP_CONFIG[key];
    if (proposedValue !== undefined && currentValue !== proposedValue) {
      changes.push({
        key,
        currentValue,
        proposedValue,
        envVar: CONFIG_ENV_VARS[key],
      });
    }
  }

  // Generate env var commands
  const envCommands = changes.map((c) => {
    const value =
      typeof c.proposedValue === 'boolean'
        ? c.proposedValue
          ? 'true'
          : 'false'
        : String(c.proposedValue);
    return `export ${c.envVar}=${value}`;
  });

  return successResponse({
    success: true,
    data: {
      message:
        'Preview only - configuration changes require environment variable updates',
      changes,
      envCommands,
      instructions: [
        '1. Set the environment variables on your deployment',
        '2. Restart the service to apply changes',
        '3. Changes take effect on the next game tick',
      ],
      auditLog: {
        requestedBy: admin.userId,
        requestedAt: new Date().toISOString(),
        role: admin.role,
      },
    },
  });
});
