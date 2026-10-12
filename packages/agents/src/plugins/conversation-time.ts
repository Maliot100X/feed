/**
 * Shared timestamp formatting for conversation-history providers.
 */

import { getTimeAgo } from '@feed/shared';

/** Relative time like "just now", "5m ago", "3h ago", "2d ago". */
export function formatRelativeTime(date: Date): string {
  return getTimeAgo(date);
}

/** Local wall-clock time as zero-padded HH:MM. */
export function formatClockTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}
