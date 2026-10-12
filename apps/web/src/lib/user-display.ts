/**
 * Centralized display name and handle resolution for user-like objects.
 * Keeps fallback order and default labels consistent across the app.
 */

export interface UserDisplayFields {
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  twitterUsername?: string | null;
  walletAddress?: string | null;
}

/** First candidate that is non-empty after trimming (blank values are skipped). */
function firstNonBlank(
  candidates: ReadonlyArray<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Resolve a display name from user-like object with consistent fallback order.
 * @param user - Object with displayName, username, email, etc.
 * @param fallback - Default when no name is available (default: 'User')
 */
export function getUserDisplayName(
  user: UserDisplayFields | null | undefined,
  fallback = 'User'
): string {
  if (!user) return fallback;
  return (
    firstNonBlank([
      user.displayName,
      user.username,
      user.email,
      user.twitterUsername,
      user.walletAddress,
    ]) ?? fallback
  );
}

/**
 * Resolve a handle (username/handle) for mentions or secondary display.
 * @param fallback - Default when no handle is available (default: '')
 */
export function getUserHandle(
  user:
    | Pick<UserDisplayFields, 'username' | 'twitterUsername' | 'walletAddress'>
    | null
    | undefined,
  fallback = ''
): string {
  if (!user) return fallback;
  return (
    firstNonBlank([user.username, user.twitterUsername, user.walletAddress]) ??
    fallback
  );
}
