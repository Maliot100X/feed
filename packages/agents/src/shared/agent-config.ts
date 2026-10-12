/**
 * Agent Config Helper
 *
 * Utility functions for accessing agent configuration from the UserAgentConfig table.
 * This replaces direct access to agent fields that were previously on the User table.
 */

import {
  db,
  eq,
  type UserAgentConfig,
  userAgentConfigs,
  users,
} from '@feed/db';
import { generateSnowflakeId } from './snowflake';

/**
 * Get agent config for a user
 */
async function fetchAgentConfig(
  userId: string
): Promise<UserAgentConfig | null> {
  const result = await db
    .select()
    .from(userAgentConfigs)
    .where(eq(userAgentConfigs.userId, userId))
    .limit(1);
  return result[0] ?? null;
}

export async function getAgentConfig(
  userId: string
): Promise<UserAgentConfig | null> {
  const existing = await fetchAgentConfig(userId);
  if (existing) return existing;

  const [user] = await db
    .select({ id: users.id, isAgent: users.isAgent })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.isAgent) return null;

  const now = new Date();
  const [created] = await db
    .insert(userAgentConfigs)
    .values({
      id: await generateSnowflakeId(),
      userId,
      // Explicit true ensures agents trade by default regardless of DB migration state
      autonomousTrading: true,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: userAgentConfigs.userId })
    .returning();

  if (created) return created;

  return await fetchAgentConfig(userId);
}

/**
 * Create or update agent config in one statement (insert-on-conflict-update),
 * so concurrent callers cannot race between a read and an insert.
 */
export async function upsertAgentConfig(
  userId: string,
  config: Partial<Omit<UserAgentConfig, 'id' | 'userId' | 'createdAt'>>
): Promise<UserAgentConfig> {
  const now = new Date();
  const [result] = await db
    .insert(userAgentConfigs)
    .values({
      id: await generateSnowflakeId(),
      userId,
      ...config,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userAgentConfigs.userId,
      set: { ...config, updatedAt: now },
    })
    .returning();

  if (!result) {
    throw new Error(`Failed to upsert agent config for user ${userId}`);
  }
  return result;
}

// Legacy config helpers (getSystemPrompt, getStyle, getMessageExamples, etc.) removed.
// Access config fields directly: config?.systemPrompt, config?.style, etc.

/**
 * Helper to check if autonomous trading is enabled
 * Defaults to true to match database schema (autonomousTrading defaults to true)
 */
export function isAutonomousTradingEnabled(
  config: UserAgentConfig | null
): boolean {
  // Note: Database schema defaults autonomousTrading to true for new agents
  // When config is null (no config exists), we default to false (agent not set up)
  // When config exists but autonomousTrading is null/undefined (legacy), default to true
  if (!config) return false;
  return config.autonomousTrading ?? true;
}

/**
 * Helper to check if autonomous posting is enabled
 */
export function isAutonomousPostingEnabled(
  config: UserAgentConfig | null
): boolean {
  return config?.autonomousPosting ?? false;
}

/**
 * Helper to check if autonomous commenting is enabled
 */
export function isAutonomousCommentingEnabled(
  config: UserAgentConfig | null
): boolean {
  return config?.autonomousCommenting ?? false;
}

/**
 * Helper to check if autonomous DMs are enabled
 */
export function isAutonomousDMsEnabled(
  config: UserAgentConfig | null
): boolean {
  return config?.autonomousDMs ?? false;
}

/**
 * Helper to check if autonomous group chats are enabled
 */
export function isAutonomousGroupChatsEnabled(
  config: UserAgentConfig | null
): boolean {
  return config?.autonomousGroupChats ?? false;
}

/**
 * Helper to check if autonomous transfers are enabled
 */
export function isAutonomousTransfersEnabled(
  config: UserAgentConfig | null
): boolean {
  return config?.autonomousTransfers ?? false;
}

/**
 * Get all autonomous feature flags with proper defaults
 * Trading defaults to true, all others default to false
 */
export function getAutonomousFeatures(config: UserAgentConfig | null) {
  return {
    trading: isAutonomousTradingEnabled(config),
    posting: isAutonomousPostingEnabled(config),
    commenting: isAutonomousCommentingEnabled(config),
    dms: isAutonomousDMsEnabled(config),
    groupChats: isAutonomousGroupChatsEnabled(config),
    transfers: isAutonomousTransfersEnabled(config),
  };
}

/**
 * Check if any autonomous feature is enabled
 */
export function hasAnyAutonomousFeature(
  config: UserAgentConfig | null
): boolean {
  const features = getAutonomousFeatures(config);
  return (
    features.trading ||
    features.posting ||
    features.commenting ||
    features.dms ||
    features.groupChats ||
    features.transfers
  );
}

/**
 * Helper to get model tier from config
 */
export function getModelTier(config: UserAgentConfig | null): string {
  return config?.modelTier ?? 'free';
}

export function getAlignment(
  config: Pick<UserAgentConfig, 'alignment'> | null
): 'good' | 'neutral' | 'evil' {
  const val = config?.alignment;
  if (val === 'good' || val === 'evil') return val;
  return 'neutral';
}

export function getTeam(
  config: Pick<UserAgentConfig, 'team'> | null
): 'red' | 'blue' | 'gray' {
  const val = config?.team;
  if (val === 'red' || val === 'blue') return val;
  return 'gray';
}
