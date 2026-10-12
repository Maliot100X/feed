import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch } from '@/utils/api-fetch';

/**
 * Represents unread message counts.
 */
interface UnreadCounts {
  /** Number of pending DM requests from anonymous users */
  pendingDMs: number;
  /** Number of unread chat message notifications */
  unreadMessages: number;
  /** Whether there are new messages in existing chats */
  hasNewMessages: boolean;
}

/**
 * Hook for efficiently polling unread and pending message counts.
 *
 * Polls the API every 30 seconds to check for:
 * - Pending DM requests from anonymous users
 * - New messages in existing chats
 *
 * Returns counts suitable for displaying notification badges. Only polls
 * when the user is authenticated. Automatically stops polling on unmount
 * or when user logs out.
 *
 * @returns An object containing:
 * - `pendingDMs`: Number of pending DM requests
 * - `unreadMessages`: Number of unread chat notifications
 * - `hasNewMessages`: Whether there are new messages in existing chats
 * - `totalUnread`: Combined unread count (pending DM requests + unread chat notifications)
 * - `isLoading`: Whether counts are currently being fetched
 *
 * @example
 * ```tsx
 * const { pendingDMs, hasNewMessages, totalUnread } = useUnreadMessages();
 *
 * return (
 *   <Badge>
 *     {totalUnread > 0 && totalUnread}
 *   </Badge>
 * );
 * ```
 */
const EMPTY_COUNTS: UnreadCounts = {
  pendingDMs: 0,
  unreadMessages: 0,
  hasNewMessages: false,
};

export function useUnreadMessages() {
  const { authenticated, user } = useAuth();
  const userId = authenticated ? (user?.id ?? null) : null;
  const [counts, setCounts] = useState<UnreadCounts>(EMPTY_COUNTS);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Reset on logout and on account switch so counts never leak across users.
    setCounts(EMPTY_COUNTS);
    if (!userId) {
      setIsLoading(false);
      return;
    }

    let disposed = false;
    let controller: AbortController | null = null;

    const fetchCounts = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await apiFetch('/api/chats/unread-count', {
          signal: current.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          pendingDMRequests?: number;
          unreadMessages?: number;
          hasNewMessages?: boolean;
        };
        if (disposed || current.signal.aborted) return;
        setCounts({
          pendingDMs:
            typeof data.pendingDMRequests === 'number'
              ? data.pendingDMRequests
              : 0,
          unreadMessages:
            typeof data.unreadMessages === 'number' ? data.unreadMessages : 0,
          hasNewMessages: data.hasNewMessages === true,
        });
      } catch {
        // Network/abort/JSON failure: keep the last known counts.
      } finally {
        if (!disposed && controller === current) setIsLoading(false);
      }
    };

    setIsLoading(true);
    void fetchCounts();
    const interval = setInterval(() => void fetchCounts(), 30000);

    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(interval);
    };
  }, [userId]);

  return {
    ...counts,
    totalUnread: counts.pendingDMs + counts.unreadMessages,
    isLoading,
  };
}
