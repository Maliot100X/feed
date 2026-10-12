/**
 * Prediction Markets Store - Centralized state management for prediction markets data
 *
 * This store prevents duplicate API calls by:
 * 1. Caching data with a TTL (10 seconds)
 * 2. Deduplicating concurrent requests via a fetchPromise
 * 3. Providing a single polling mechanism that all components share
 *
 * Usage:
 * ```tsx
 * import { usePredictionMarkets, usePredictionMarketsPolling } from '@/stores/predictionMarketsStore';
 *
 * function MyComponent() {
 *   const { markets, loading, error, refetch } = usePredictionMarkets();
 *   usePredictionMarketsPolling(30000); // Optional: enable polling every 30s
 *   return <div>{markets.map(m => ...)}</div>;
 * }
 * ```
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { PredictionMarket } from '@/types/markets';
import { MARKETS_CONFIG } from '@/types/markets';
import { apiFetch } from '@/utils/api-fetch';

// Re-export for backwards compatibility
export type { PredictionMarket } from '@/types/markets';

interface PredictionMarketsState {
  // Data
  markets: PredictionMarket[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  /**
   * Viewer the cached markets were fetched for ('' = anonymous). Responses
   * include that viewer's private positions, so they are never reused for a
   * different viewer.
   */
  viewerKey: string | null;

  // Internal state for request deduplication
  fetchPromise: Promise<void> | null;
  fetchSeq: number;
  pollingInterval: ReturnType<typeof setInterval> | null;
  pollingViewerKey: string | null;
  pollingGeneration: number;
  subscriberCount: number;

  // Actions
  fetchMarkets: (force?: boolean, userId?: string) => Promise<void>;
  subscribe: (intervalMs: number, userId?: string) => () => void;
}

// Use centralized cache TTL
const CACHE_TTL = MARKETS_CONFIG.CACHE_TTL_MS;

const toViewerKey = (userId?: string) => userId ?? '';

export const usePredictionMarketsStore = create<PredictionMarketsState>(
  (set, get) => ({
    markets: [],
    loading: false,
    error: null,
    lastFetchedAt: null,
    viewerKey: null,
    fetchPromise: null,
    fetchSeq: 0,
    pollingInterval: null,
    pollingViewerKey: null,
    pollingGeneration: 0,
    subscriberCount: 0,

    fetchMarkets: async (force = false, userId?: string) => {
      const state = get();
      const viewerKey = toViewerKey(userId);

      // Deduplicate concurrent requests for the same viewer only
      if (state.fetchPromise && state.viewerKey === viewerKey) {
        return state.fetchPromise;
      }

      // Return cached data if fresh, for the same viewer, and not forced
      // (an empty market list is a valid cached result).
      if (
        !force &&
        state.viewerKey === viewerKey &&
        state.lastFetchedAt &&
        Date.now() - state.lastFetchedAt < CACHE_TTL
      ) {
        return;
      }

      const seq = state.fetchSeq + 1;
      const isCurrent = () => get().fetchSeq === seq;
      const switchingViewer = state.viewerKey !== viewerKey;

      const fetchPromise = (async () => {
        if (switchingViewer) {
          // Never show another viewer's positions while loading.
          set({ markets: [], lastFetchedAt: null });
        }
        if (switchingViewer || get().markets.length === 0) {
          set({ loading: true });
        }
        set({ error: null, viewerKey });

        try {
          // Authenticated: the API only includes positions for the matching
          // authenticated viewer.
          const url = userId
            ? `/api/markets/predictions?userId=${encodeURIComponent(userId)}`
            : '/api/markets/predictions';
          const response = await apiFetch(url, { auth: Boolean(userId) });
          if (!response.ok) {
            throw new Error(
              `Failed to fetch prediction markets: ${response.status}`
            );
          }

          const data = await response.json();
          if (!isCurrent()) return;
          if (data.questions && Array.isArray(data.questions)) {
            set({
              markets: data.questions,
              lastFetchedAt: Date.now(),
              error: null,
            });
          }
        } catch (err) {
          if (!isCurrent()) return;
          const errorMessage =
            err instanceof Error
              ? err.message
              : 'Failed to fetch prediction markets';
          set({ error: errorMessage });
        } finally {
          if (isCurrent()) set({ loading: false, fetchPromise: null });
        }
      })();

      set({ fetchPromise, fetchSeq: seq });
      return fetchPromise;
    },

    // Polling belongs to one viewer; subscribing for a different viewer
    // restarts it, and unsubscribes from an earlier generation are no-ops.
    subscribe: (intervalMs: number, userId?: string) => {
      const state = get();
      const viewerKey = toViewerKey(userId);

      let generation = state.pollingGeneration;
      if (
        state.pollingInterval === null ||
        state.pollingViewerKey !== viewerKey
      ) {
        if (state.pollingInterval) clearInterval(state.pollingInterval);
        generation = state.pollingGeneration + 1;
        const interval = setInterval(() => {
          void get().fetchMarkets(true, userId);
        }, intervalMs);
        set({
          pollingInterval: interval,
          pollingViewerKey: viewerKey,
          pollingGeneration: generation,
          subscriberCount: 1,
        });
        void get().fetchMarkets(false, userId);
      } else {
        set({ subscriberCount: state.subscriberCount + 1 });
      }

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const current = get();
        if (current.pollingGeneration !== generation) return;
        const remaining = current.subscriberCount - 1;
        if (remaining > 0) {
          set({ subscriberCount: remaining });
          return;
        }
        if (current.pollingInterval) clearInterval(current.pollingInterval);
        set({
          subscriberCount: 0,
          pollingInterval: null,
          pollingViewerKey: null,
        });
      };
    },
  })
);

// Selector for data (memoized by zustand)
const dataSelector = (state: PredictionMarketsState) => ({
  markets: state.markets,
  loading: state.loading,
  error: state.error,
});

/**
 * Hook for consuming prediction markets data
 * Automatically fetches data on mount if not cached
 */
export function usePredictionMarkets(userId?: string) {
  // Single subscription with shallow comparison for the object
  const { markets, loading, error } = usePredictionMarketsStore(
    useShallow(dataSelector)
  );
  const fetchMarkets = usePredictionMarketsStore((state) => state.fetchMarkets);

  // Fetch on mount if needed
  useEffect(() => {
    fetchMarkets(false, userId);
  }, [fetchMarkets, userId]);

  const refetch = useCallback(() => {
    return fetchMarkets(true, userId);
  }, [fetchMarkets, userId]);

  return { markets, loading, error, refetch };
}

/**
 * Hook for enabling polling on prediction markets
 * Uses reference counting so multiple components can request polling
 * and it only stops when all components unmount
 *
 * @param intervalMs - Polling interval in milliseconds (default: 30000)
 * @param userId - Optional user ID for fetching with positions
 */
export function usePredictionMarketsPolling(
  intervalMs = 30000,
  userId?: string
) {
  const subscribe = usePredictionMarketsStore((state) => state.subscribe);

  // Interval is read once; the viewer is tracked so login/logout and
  // account switches re-subscribe for the right user.
  const intervalRef = useRef(intervalMs);

  useEffect(() => {
    return subscribe(intervalRef.current, userId);
  }, [subscribe, userId]);
}

/**
 * Get a specific market by ID (memoized)
 */
export function usePredictionMarket(marketId: string | number) {
  const { markets, loading, error, refetch } = usePredictionMarkets();

  const market = useMemo(
    () => markets.find((m) => m.id.toString() === marketId.toString()),
    [markets, marketId]
  );

  return { market, loading, error, refetch };
}

/**
 * Get active markets only (memoized)
 */
export function useActivePredictionMarkets() {
  const { markets, loading, error, refetch } = usePredictionMarkets();

  const activeMarkets = useMemo(
    () => markets.filter((m) => m.status === 'active'),
    [markets]
  );

  return { markets: activeMarkets, loading, error, refetch };
}

/**
 * Get market statistics (memoized)
 */
export function usePredictionMarketsStats() {
  const { markets, loading } = usePredictionMarkets();

  const stats = useMemo(
    () => ({
      total: markets.length,
      active: markets.filter((m) => m.status === 'active').length,
      resolved: markets.filter((m) => m.status === 'resolved').length,
      totalVolume: markets.reduce(
        (sum, m) => sum + (m.yesShares || 0) + (m.noShares || 0),
        0
      ),
    }),
    [markets]
  );

  return { stats, loading };
}
