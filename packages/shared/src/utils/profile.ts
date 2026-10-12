/**
 * Profile URL Utility Functions
 *
 * @description Utility functions for generating profile URLs and identifying
 * usernames vs user IDs. Handles username preference and identifier parsing.
 */

import { resolveUserIdentifierKind } from './user-identifier';

/**
 * Generate a profile URL for a user
 *
 * @description Creates a profile URL preferring username if available, falling
 * back to user ID. Automatically strips @ prefix from usernames.
 *
 * @param {string} userId - User ID to use as fallback
 * @param {string | null | undefined} username - Optional username (preferred)
 * @returns {string} Profile URL path (e.g., "/profile/username" or "/profile/userId")
 *
 * @example
 * ```typescript
 * getProfileUrl('user_123', 'alice') // Returns "/profile/alice"
 * getProfileUrl('user_123', null) // Returns "/profile/user_123"
 * getProfileUrl('user_123', '@alice') // Returns "/profile/alice"
 * ```
 */
export function getProfileUrl(
  userId: string,
  username?: string | null
): string {
  if (username) {
    // Strip @ if present and use clean username
    const cleanUsername = username.startsWith('@')
      ? username.slice(1)
      : username;
    return `/profile/${cleanUsername}`;
  }
  return `/profile/${userId}`;
}

/**
 * Canonical user profile URL.
 *
 * Prefer username handle when available; fallback to id-based route.
 */
export function getUserProfileUrl(
  userId: string,
  username?: string | null
): string {
  if (username) {
    const cleanUsername = username.startsWith('@')
      ? username.slice(1)
      : username;
    return `/u/${cleanUsername}`;
  }
  return `/u/id/${userId}`;
}

/**
 * Canonical actor profile URL.
 */
export function getActorProfileUrl(actorId: string): string {
  return `/actors/${actorId}`;
}

/**
 * Canonical organization profile URL.
 */
export function getOrganizationProfileUrl(orgId: string): string {
  return `/orgs/${orgId}`;
}

/**
 * Longest identifier treated as a username. Wider than UsernameSchema (30)
 * because legacy handles can be wallet addresses (42 chars).
 */
const MAX_USERNAME_LENGTH = 42;

/**
 * Check if a profile identifier is a username (not a user ID)
 *
 * @description Uses the same classifier as server-side user lookup
 * ({@link resolveUserIdentifierKind}) so the client and server agree. An
 * explicit `@` prefix always means username; any DID, UUID or snowflake ID is
 * an ID; values longer than the maximum username length are IDs.
 *
 * @example
 * ```typescript
 * isUsername('alice') // true
 * isUsername('@alice') // true
 * isUsername('my-handle') // true (hyphens are valid in usernames)
 * isUsername('did:privy:abc123') // false
 * isUsername('550e8400-e29b-41d4-a716-446655440000') // false (UUID)
 * isUsername('263849173829304320') // false (snowflake ID)
 * ```
 */
export function isUsername(identifier: string): boolean {
  if (identifier.startsWith('@')) {
    return true;
  }
  if (identifier.startsWith('did:')) {
    return false;
  }
  if (identifier.length > MAX_USERNAME_LENGTH) {
    return false;
  }
  return resolveUserIdentifierKind(identifier) === 'username';
}

/**
 * Extract username from identifier (removes @ prefix if present)
 *
 * @description Extracts a clean username from an identifier string, removing
 * the @ prefix if present. Useful for normalizing username inputs.
 *
 * @param {string} identifier - The identifier to extract username from
 * @returns {string} Clean username without @ prefix
 *
 * @example
 * ```typescript
 * extractUsername('@alice') // Returns "alice"
 * extractUsername('alice') // Returns "alice"
 * ```
 */
export function extractUsername(identifier: string): string {
  return identifier.startsWith('@') ? identifier.slice(1) : identifier;
}
