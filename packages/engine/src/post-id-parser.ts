/**
 * Post ID Parser
 *
 * @description Type-safe parser for extracting metadata from various post ID formats.
 * Supports multiple formats used throughout the application, including game-generated
 * posts, user posts, and legacy formats. Automatically detects format and extracts
 * game ID, author ID, and timestamp.
 */

/**
 * Parsed post metadata from post ID
 *
 * @description Contains extracted metadata from a parsed post ID, including the game
 * context, author information, and timestamp.
 */
export interface ParsedPostMetadata {
  gameId: string;
  authorId: string;
  timestamp: Date;
}

/**
 * Parse result, discriminated by `success`.
 *
 * @description On failure no metadata is returned: callers must not fabricate
 * an author or timestamp for an unrecognised post ID.
 */
export type ParseResult =
  | { success: true; metadata: ParsedPostMetadata }
  | { success: false; metadata?: undefined };

const ISO_TIMESTAMP_SUFFIX =
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)$/;

/** Parse a strictly numeric millisecond timestamp (no trailing garbage). */
function parseEpochMs(value: string): Date | null {
  if (!/^\d+$/.test(value)) return null;
  const timestamp = new Date(Number(value));
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

/**
 * Parse Format 1: gameId-gameTimestamp-authorId-isoTimestamp
 * Example: feed-1761441310151-kash-patrol-2025-10-01T02:12:00Z
 */
function parseFormat1(postId: string): ParsedPostMetadata | null {
  const isoTimestampMatch = postId.match(ISO_TIMESTAMP_SUFFIX);
  if (!isoTimestampMatch?.[1]) return null;

  const timestampStr = isoTimestampMatch[1];
  const timestamp = new Date(timestampStr);
  if (Number.isNaN(timestamp.getTime())) return null;

  // gameId-gameTimestamp-<authorId>-<iso>
  const prefix = postId.slice(0, -(timestampStr.length + 1));
  const match = prefix.match(/^([^-]+)-([^-]+)-(.+)$/);
  if (!match?.[1] || !match[3]) return null;

  return { gameId: match[1], authorId: match[3], timestamp };
}

/**
 * Parse Format 2/3: post-{timestamp}-{actorId?}-{random}
 * Format 2: post-1762099655817-0.7781412938928327
 * Format 3: post-1762099655817-kash-patrol-abc123 (actor IDs may contain hyphens)
 */
function parsePostFormat(postId: string): ParsedPostMetadata | null {
  if (!postId.startsWith('post-')) return null;

  const parts = postId.split('-');
  if (parts.length < 3) return null;

  const timestampPart = parts[1];
  if (!timestampPart) return null;
  const timestamp = parseEpochMs(timestampPart);
  if (!timestamp || timestamp.getTime() <= 1000000000000) return null;

  if (parts.length === 3) {
    // Format 2: post-{timestamp}-{random}; no author encoded.
    return { gameId: 'feed', authorId: 'system', timestamp };
  }

  // Format 3: everything between the timestamp and the trailing random segment.
  const authorId = parts.slice(2, -1).join('-');
  if (!authorId) return null;
  return { gameId: 'feed', authorId, timestamp };
}

/**
 * Parse Format 4: game-{gameId}-{timestamp} (legacy; timestamp is ISO or epoch ms)
 */
function parseGameFormat(postId: string): ParsedPostMetadata | null {
  if (!postId.startsWith('game-')) return null;

  const parts = postId.split('-');
  if (parts.length < 3) return null;

  const gameId = parts[1];
  if (!gameId) return null;

  const timestampPart = parts.slice(2).join('-');
  if (!timestampPart) return null;

  const timestamp = ISO_TIMESTAMP_SUFFIX.test(timestampPart)
    ? new Date(timestampPart)
    : parseEpochMs(timestampPart);
  if (!timestamp || Number.isNaN(timestamp.getTime())) return null;

  return { gameId, authorId: 'system', timestamp };
}

/**
 * Parse post ID and extract metadata
 *
 * @description Parses a post ID string and extracts metadata (gameId, authorId, timestamp).
 * Supports multiple post ID formats (prefix-specific formats are tried first):
 * - Format 2/3: post-{timestamp}-{actorId?}-{random}
 * - Format 4: game-{gameId}-{timestamp} (legacy)
 * - Format 1: gameId-gameTimestamp-authorId-isoTimestamp
 *
 * Returns `{ success: false }` without metadata when no format matches.
 *
 * @param {string} postId - The post ID to parse
 * @returns {ParseResult} Parse result with metadata on success
 *
 * @example
 * ```typescript
 * const result = parsePostId('feed-1761441310151-kash-patrol-2025-10-01T02:12:00Z');
 * if (result.success) {
 *   console.log(`Post by ${result.metadata.authorId} at ${result.metadata.timestamp}`);
 * }
 * ```
 */
export function parsePostId(postId: string): ParseResult {
  const metadata =
    parsePostFormat(postId) ?? parseGameFormat(postId) ?? parseFormat1(postId);
  return metadata ? { success: true, metadata } : { success: false };
}
