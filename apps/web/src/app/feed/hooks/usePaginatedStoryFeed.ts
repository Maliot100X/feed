import type { NarrativeStory } from '@feed/shared';
import { logger } from '@feed/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSSEChannel } from '@/hooks/useSSE';
import { apiFetch } from '@/utils/api-fetch';

const PAGE_SIZE = 20;
const SSE_DEBOUNCE_MS = 2_000;

export interface StoryFeedPage {
  stories?: NarrativeStory[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface PaginatedStoryFeedResult {
  stories: NarrativeStory[];
  ready: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => void;
}

export function getStoryFeedSseChannel(
  enabled: boolean,
  authReady: boolean
): 'feed' | null {
  return enabled && authReady ? 'feed' : null;
}

interface PaginatedStoryFeedOptions<TPage extends StoryFeedPage> {
  endpoint: string;
  enabled: boolean;
  /** Logger context and human label used in error messages. */
  logContext: string;
  label: string;
  /** Called with each first-page response (e.g. to read a topic header). */
  onFirstPage?: (page: TPage) => void;
}

/**
 * Cursor-paginated story feed (For You / Stories).
 *
 * Every request carries the feed generation it was started for; a refresh,
 * viewer change or disable bumps the generation so older responses (initial
 * page or loadMore) can never commit, and never leave a spinner stuck.
 * Pagination is gated while a fresh first page is loading.
 */
export function usePaginatedStoryFeed<TPage extends StoryFeedPage>({
  endpoint,
  enabled,
  logContext,
  label,
  onFirstPage,
}: PaginatedStoryFeedOptions<TPage>): PaginatedStoryFeedResult {
  const { ready: authReady, authenticated, user } = useAuth();
  // Personalized feeds must never show one viewer's stories to another.
  const viewerKey = authenticated ? `user:${user?.id ?? ''}` : 'anonymous';

  const [stories, setStories] = useState<NarrativeStory[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storiesRef = useRef<NarrativeStory[]>([]);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const hasMoreRef = useRef(false);
  const cursorRef = useRef<string | null>(null);
  const sseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFirstPageRef = useRef(onFirstPage);
  onFirstPageRef.current = onFirstPage;

  const syncHasMore = useCallback((value: boolean) => {
    hasMoreRef.current = value;
    setHasMore(value);
  }, []);

  /** Abort everything in flight and invalidate older responses. */
  const invalidate = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setLoadingMore(false);
    if (sseDebounceRef.current) {
      clearTimeout(sseDebounceRef.current);
      sseDebounceRef.current = null;
    }
  }, []);

  const fetchPage = useCallback(
    async (cursor: string | null, signal: AbortSignal): Promise<TPage> => {
      const url = cursor
        ? `${endpoint}?cursor=${encodeURIComponent(cursor)}&limit=${PAGE_SIZE}`
        : `${endpoint}?limit=${PAGE_SIZE}`;
      const response = await apiFetch(url, { signal, auth: authenticated });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as TPage;
    },
    [endpoint, authenticated]
  );

  const loadFirstPage = useCallback(async () => {
    invalidate();
    const generation = generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    // No pagination against the old snapshot while the new one loads.
    cursorRef.current = null;
    syncHasMore(false);
    setLoading(true);
    try {
      const data = await fetchPage(null, controller.signal);
      if (generation !== generationRef.current) return;
      const items = data.stories ?? [];
      storiesRef.current = items;
      cursorRef.current = data.nextCursor ?? null;
      setStories(items);
      onFirstPageRef.current?.(data);
      syncHasMore(data.hasMore ?? false);
      setError(null);
    } catch (err) {
      if (generation !== generationRef.current) return;
      const msg = `Failed to load ${label}`;
      logger.error(msg, { error: err }, logContext);
      if (storiesRef.current.length === 0) setError(msg);
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        setReady(true);
      }
    }
  }, [fetchPage, invalidate, label, logContext, syncHasMore]);

  const refresh = useCallback(async () => {
    if (!enabled || !authReady) return;
    await loadFirstPage();
  }, [enabled, authReady, loadFirstPage]);

  const loadMore = useCallback(() => {
    if (loadMoreControllerRef.current || !hasMoreRef.current) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true);

    void fetchPage(cursorRef.current, controller.signal)
      .then((data) => {
        if (generation !== generationRef.current) return;
        const seen = new Set(storiesRef.current.map((s) => s.storyKey));
        const next = (data.stories ?? []).filter((s) => !seen.has(s.storyKey));
        cursorRef.current = data.nextCursor ?? null;
        const merged = [...storiesRef.current, ...next];
        storiesRef.current = merged;
        setStories(merged);
        syncHasMore(data.hasMore ?? false);
      })
      .catch((err) => {
        if (generation !== generationRef.current) return;
        logger.error(
          `Failed to load more ${label}`,
          { error: err },
          logContext
        );
      })
      .finally(() => {
        // Only the request that is still current releases the lock/spinner.
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
          setLoadingMore(false);
        }
      });
  }, [fetchPage, label, logContext, syncHasMore]);

  // SSE is the refresh mechanism (no polling: it would reset to page 1).
  useSSEChannel(
    getStoryFeedSseChannel(enabled, authReady),
    useCallback(() => {
      if (sseDebounceRef.current) clearTimeout(sseDebounceRef.current);
      sseDebounceRef.current = setTimeout(() => {
        sseDebounceRef.current = null;
        void refresh();
      }, SSE_DEBOUNCE_MS);
    }, [refresh])
  );

  // (Re)load on enable and on viewer change; clear the previous viewer's
  // stories immediately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a viewer change (viewerKey) must clear and reload even when no callback identity changes
  useEffect(() => {
    storiesRef.current = [];
    setStories([]);
    setError(null);
    setReady(false);
    syncHasMore(false);
    if (!enabled || !authReady) {
      invalidate();
      setLoading(false);
      return;
    }
    void loadFirstPage();
    return invalidate;
  }, [enabled, authReady, viewerKey, loadFirstPage, invalidate, syncHasMore]);

  return {
    stories,
    ready,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
  };
}
