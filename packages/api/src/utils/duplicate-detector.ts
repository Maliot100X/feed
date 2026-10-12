/**
 * Duplicate Content Detection Utility
 *
 * Best-effort, per-process throttle that rejects the same normalized content
 * from the same user within a short window. It is not a cross-instance
 * uniqueness guarantee (each worker has its own memory), and content is
 * recorded when checked, so a retry right after a failed write is also
 * rejected until the window passes.
 */

import { logger } from '@feed/shared';

import crypto from 'crypto';

interface DuplicateRecord {
  contentHash: string;
  timestamp: number;
}

// userId -> actionType -> recent records. Nested maps avoid parsing
// colon-delimited keys (user IDs can be DIDs such as did:privy:...).
const duplicateStore = new Map<string, Map<string, DuplicateRecord[]>>();

function recordsFor(userId: string, actionType: string): DuplicateRecord[] {
  let byAction = duplicateStore.get(userId);
  if (!byAction) {
    byAction = new Map();
    duplicateStore.set(userId, byAction);
  }
  let records = byAction.get(actionType);
  if (!records) {
    records = [];
    byAction.set(actionType, records);
  }
  return records;
}

/**
 * Duplicate detection configurations
 */
export const DUPLICATE_DETECTION_CONFIGS = {
  POST: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    actionType: 'post',
  },
  COMMENT: {
    windowMs: 2 * 60 * 1000, // 2 minutes
    actionType: 'comment',
  },
  MESSAGE: {
    windowMs: 1 * 60 * 1000, // 1 minute
    actionType: 'message',
  },
} as const;

/**
 * Create a hash of content for duplicate detection
 * Normalizes content by removing extra whitespace and converting to lowercase
 */
function hashContent(content: string): string {
  // Normalize content: trim, lowercase, remove extra whitespace
  const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');

  // Create SHA-256 hash
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Check if content is a duplicate
 * Returns true if the same content was posted recently by the same user
 */
export function checkDuplicate(
  userId: string,
  content: string,
  config: { windowMs: number; actionType: string }
): { isDuplicate: boolean; lastPostedAt?: Date } {
  const contentHash = hashContent(content);
  const now = Date.now();

  // Remove old records outside the window
  const windowStart = now - config.windowMs;
  const records = recordsFor(userId, config.actionType).filter(
    (record) => record.timestamp > windowStart
  );
  duplicateStore.get(userId)?.set(config.actionType, records);

  // Check for duplicate
  const duplicate = records.find(
    (record) => record.contentHash === contentHash
  );

  if (duplicate) {
    logger.warn('Duplicate content detected', {
      userId,
      actionType: config.actionType,
      contentHash,
      lastPostedAt: new Date(duplicate.timestamp).toISOString(),
    });

    return {
      isDuplicate: true,
      lastPostedAt: new Date(duplicate.timestamp),
    };
  }

  // Record this content
  records.push({
    contentHash,
    timestamp: now,
  });

  logger.debug('Content uniqueness check passed', {
    userId,
    actionType: config.actionType,
    contentHash,
  });

  return {
    isDuplicate: false,
  };
}

/**
 * Clear duplicate records for a user and action type
 */
export function clearDuplicates(userId: string, actionType: string): void {
  duplicateStore.get(userId)?.delete(actionType);
  logger.info('Duplicate records cleared', { userId, actionType });
}

/**
 * Clear all duplicate records
 */
export function clearAllDuplicates(): void {
  duplicateStore.clear();
  logger.info('All duplicate records cleared');
}

/** Longest configured window; records older than this are never consulted. */
const MAX_WINDOW_MS = Math.max(
  ...Object.values(DUPLICATE_DETECTION_CONFIGS).map((config) => config.windowMs)
);

/**
 * Cleanup old duplicate records periodically
 */
export function cleanupDuplicates(now: number = Date.now()): void {
  let cleanedCount = 0;

  for (const [userId, byAction] of duplicateStore.entries()) {
    for (const [actionType, records] of byAction.entries()) {
      const validRecords = records.filter(
        (record) => now - record.timestamp < MAX_WINDOW_MS
      );
      if (validRecords.length === 0) {
        byAction.delete(actionType);
        cleanedCount++;
      } else if (validRecords.length < records.length) {
        byAction.set(actionType, validRecords);
      }
    }
    if (byAction.size === 0) duplicateStore.delete(userId);
  }

  if (cleanedCount > 0) {
    logger.info('Cleaned up old duplicate records', {
      cleanedCount,
      totalRemaining: duplicateStore.size,
    });
  }
}

/**
 * Get statistics about duplicate detection
 */
export function getDuplicateStats(): {
  totalUsers: number;
  totalRecords: number;
  recordsByType: Record<string, number>;
} {
  const stats = {
    totalUsers: duplicateStore.size,
    totalRecords: 0,
    recordsByType: {} as Record<string, number>,
  };

  for (const byAction of duplicateStore.values()) {
    for (const [actionType, records] of byAction.entries()) {
      stats.totalRecords += records.length;
      stats.recordsByType[actionType] =
        (stats.recordsByType[actionType] || 0) + records.length;
    }
  }

  return stats;
}

// Run cleanup every 5 minutes; unref() so it never keeps a process alive.
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupDuplicates, 5 * 60 * 1000).unref?.();
}
