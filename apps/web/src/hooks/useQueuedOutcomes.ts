'use client';

import { logger } from '@feed/shared';

import { useEffect, useRef } from 'react';
import type { OutcomeNotification } from '@/components/notifications/OutcomeNotificationPopup';
import { useOutcomeNotification } from '@/components/providers/OutcomeNotificationProvider';
import { useAuth } from '@/hooks/useAuth';
import {
  isMarketResolvedData,
  type MarketResolvedData,
} from '@/types/notifications';
import { apiFetch } from '@/utils/api-fetch';

interface QueuedNotification {
  id: string;
  type: string;
  data?: Record<string, unknown>;
}

interface NotificationsApiResponse {
  notifications: QueuedNotification[];
}

/**
 * After authentication, fetches undelivered `market_resolved` notifications
 * and shows them via the outcome notification provider, then marks them read.
 *
 * Delivery is tracked per user ID (`deliveredForRef`): an account switch
 * delivers for the new user, and a response for a previous user is dropped.
 * Failures before display leave the user unmarked so a later render retries.
 */
export function useQueuedOutcomes(): void {
  const { authenticated, user } = useAuth();
  const { showOutcome, showBatchOutcomes } = useOutcomeNotification();
  const deliveredForRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const userId = authenticated ? (user?.id ?? null) : null;
  currentUserIdRef.current = userId;

  useEffect(() => {
    if (!userId || deliveredForRef.current === userId) return;

    // Guard immediately (Strict Mode double-invoke) for this user only.
    deliveredForRef.current = userId;

    const deliver = async () => {
      let body: NotificationsApiResponse;
      try {
        const res = await apiFetch(
          '/api/notifications?type=market_resolved&unreadOnly=true&limit=20'
        );
        if (!res.ok) {
          logger.warn(
            'Failed to fetch queued outcome notifications',
            { status: res.status },
            'useQueuedOutcomes'
          );
          if (deliveredForRef.current === userId)
            deliveredForRef.current = null;
          return;
        }
        body = (await res.json()) as NotificationsApiResponse;
      } catch (err) {
        logger.warn(
          'Failed to fetch queued outcome notifications',
          { error: err },
          'useQueuedOutcomes'
        );
        if (deliveredForRef.current === userId) deliveredForRef.current = null;
        return;
      }

      // The account changed while the request was in flight.
      if (currentUserIdRef.current !== userId) return;

      const resolved = body.notifications.filter(
        (n): n is QueuedNotification & { data: MarketResolvedData } =>
          n.type === 'market_resolved' && isMarketResolvedData(n.data)
      );

      if (resolved.length === 0) return;

      const outcomes: Omit<OutcomeNotification, 'id'>[] = resolved.map((n) => ({
        marketId: n.data.marketId,
        marketName: n.data.marketName,
        outcome: n.data.outcome,
        points: n.data.points,
        agentName: n.data.agentName,
        deepLink: n.data.deepLink,
      }));

      if (outcomes.length === 1) {
        showOutcome(outcomes[0]!);
      } else {
        showBatchOutcomes(outcomes);
      }

      // Mark as read. A failure only means they may be shown again later.
      try {
        const res = await apiFetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notificationIds: resolved.map((n) => n.id),
          }),
        });
        if (!res.ok) {
          logger.warn(
            'Failed to mark outcome notifications as read',
            { status: res.status },
            'useQueuedOutcomes'
          );
        }
      } catch (err) {
        logger.warn(
          'Failed to mark outcome notifications as read',
          { error: err },
          'useQueuedOutcomes'
        );
      }
    };

    void deliver();
  }, [userId, showOutcome, showBatchOutcomes]);
}
