/**
 * Auto Daily Reward Hook
 *
 * Silently claims the daily login reward when an authenticated user
 * loads the app. Claims once per user per session (account switches claim
 * for the new user); failed attempts may retry — the server is idempotent.
 */

import { logger } from '@feed/shared';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch } from '@/utils/api-fetch';

export function useAutoDailyReward(): void {
  const { authenticated, ready, user, refresh } = useAuth();
  // Users whose claim succeeded (or was already made today) this session.
  const claimedForRef = useRef(new Set<string>());
  const inFlightForRef = useRef<string | null>(null);

  useEffect(() => {
    const userId = user?.id;
    if (!ready || !authenticated || !userId) return;
    if (claimedForRef.current.has(userId) || inFlightForRef.current === userId)
      return;
    inFlightForRef.current = userId;

    const claim = async () => {
      try {
        const res = await apiFetch('/api/users/daily-login', {
          method: 'POST',
        });
        // Leave the user unclaimed on failure so a later render can retry;
        // the server endpoint is idempotent per day.
        if (!res.ok) return;
        claimedForRef.current.add(userId);
        const result = await res.json();
        if (!result.success) return; // already claimed today
        toast.success(
          `+${result.totalAwarded} reputation! Streak: ${result.streak} days`
        );
        window.dispatchEvent(new CustomEvent('rewards-updated'));
        void refresh();
      } catch (err) {
        logger.debug(
          'Auto daily reward claim failed',
          { error: err instanceof Error ? err.message : String(err) },
          'useAutoDailyReward'
        );
      } finally {
        if (inFlightForRef.current === userId) inFlightForRef.current = null;
      }
    };

    void claim();
  }, [ready, authenticated, user?.id, refresh]);
}

/** Provider that enables auto daily reward for its subtree */
export function AutoDailyRewardProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  useAutoDailyReward();
  return children;
}
