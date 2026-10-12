'use client';

import { cn, type FeedPost } from '@feed/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PostList } from '@/app/feed/components/PostList';
import { useFeedPosts } from '@/app/feed/hooks/useFeedPosts';
import { FeedSkeleton } from '@/components/shared/Skeleton';
import { apiUrl } from '@/utils/api-url';

interface TerminalSocialFeedProps {
  perpTicker?: string | null;
}

export function TerminalSocialFeed({ perpTicker }: TerminalSocialFeedProps) {
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map());
  const tag = useMemo(() => {
    const t = perpTicker?.trim();
    if (!t) return null;
    return t.replace(/^\$/, '').toLowerCase();
  }, [perpTicker]);

  const [tagPosts, setTagPosts] = useState<FeedPost[]>([]);
  const [tagInfo, setTagInfo] = useState<{
    name: string;
    displayName: string;
    category?: string | null;
  } | null>(null);
  const [tagLoading, setTagLoading] = useState(false);
  const [tagLoadingMore, setTagLoadingMore] = useState(false);
  const [tagHasMore, setTagHasMore] = useState(true);
  const [tagOffset, setTagOffset] = useState(0);
  const [tagNotFound, setTagNotFound] = useState(false);
  const [tagError, setTagError] = useState(false);
  // User opted into the unfiltered feed via "Show all".
  const [showAll, setShowAll] = useState(false);
  const inFlightTagRef = useRef<AbortController | null>(null);

  const tagMode = tag != null && !showAll;

  const {
    posts: globalPosts,
    loading: globalLoading,
    loadingMore: globalLoadingMore,
    hasMore: globalHasMore,
    cursor: globalCursor,
    fetchPosts: fetchGlobalPosts,
  } = useFeedPosts({ enabled: !tagMode });

  useEffect(() => {
    const controller = new AbortController();
    const loadActorNames = async () => {
      const response = await fetch(apiUrl('/api/actors'), {
        signal: controller.signal,
      }).catch(() => null);
      if (!response) return;
      if (!response.ok) return;
      const data = (await response.json()) as {
        actors?: Array<{ id: string; name: string }>;
      };
      const nameMap = new Map<string, string>();
      data.actors?.forEach((actor) => {
        nameMap.set(actor.id, actor.name);
      });
      setActorNames(nameMap);
    };
    void loadActorNames();
    return () => controller.abort();
  }, []);

  const tagOffsetRef = useRef(tagOffset);
  tagOffsetRef.current = tagOffset;

  const fetchTagPosts = useCallback(
    async ({ append }: { append: boolean }) => {
      if (!tag) return;

      if (append) setTagLoadingMore(true);
      else setTagLoading(true);
      setTagError(false);

      inFlightTagRef.current?.abort();
      const controller = new AbortController();
      inFlightTagRef.current = controller;

      const limit = 20;
      const offset = append ? tagOffsetRef.current : 0;

      const response = await fetch(
        `/api/trending/${encodeURIComponent(tag)}?limit=${limit}&offset=${offset}`,
        { signal: controller.signal }
      ).catch(() => null);

      // Guard: if this request was superseded by a newer one, bail out
      if (inFlightTagRef.current !== controller || controller.signal.aborted) {
        return;
      }

      if (!response) {
        setTagError(true);
        setTagLoading(false);
        setTagLoadingMore(false);
        return;
      }

      if (response.status === 404) {
        setTagNotFound(true);
        setTagPosts([]);
        setTagInfo(null);
        setTagHasMore(true);
        setTagOffset(0);
        setTagLoading(false);
        setTagLoadingMore(false);
        return;
      }

      if (!response.ok) {
        setTagError(true);
        setTagLoading(false);
        setTagLoadingMore(false);
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        success: boolean;
        tag?: { name: string; displayName: string; category?: string | null };
        posts?: FeedPost[];
        total?: number;
      } | null;

      // Guard again after async json parsing
      if (inFlightTagRef.current !== controller || controller.signal.aborted) {
        return;
      }

      if (!data?.success) {
        setTagError(true);
        setTagLoading(false);
        setTagLoadingMore(false);
        return;
      }

      if (data.tag) setTagInfo(data.tag);
      const newPosts = data.posts ?? [];

      setTagPosts((prev) => {
        const combined = append ? [...prev, ...newPosts] : newPosts;
        const unique = new Map<string, FeedPost>();
        combined.forEach((p) => unique.set(p.id, p));
        return Array.from(unique.values()).sort((a, b) => {
          const aTime = new Date(a.timestamp ?? 0).getTime();
          const bTime = new Date(b.timestamp ?? 0).getTime();
          return bTime - aTime;
        });
      });

      const nextOffset = offset + newPosts.length;
      setTagOffset(nextOffset);
      setTagHasMore(newPosts.length === limit);
      setTagLoading(false);
      setTagLoadingMore(false);
    },
    [tag]
  );

  const resetTagState = useCallback(() => {
    setTagNotFound(false);
    setTagError(false);
    setTagPosts([]);
    setTagInfo(null);
    setTagHasMore(true);
    setTagOffset(0);
  }, []);

  useEffect(() => {
    resetTagState();
    setShowAll(false);
    if (!tag) return;
    void fetchTagPosts({ append: false });
    return () => {
      inFlightTagRef.current?.abort();
      inFlightTagRef.current = null;
    };
  }, [tag, fetchTagPosts, resetTagState]);

  const restoreTagFilter = useCallback(() => {
    resetTagState();
    setShowAll(false);
    void fetchTagPosts({ append: false });
  }, [fetchTagPosts, resetTagState]);

  const onLoadMore = useCallback(() => {
    if (tagMode) {
      if (!tagHasMore || tagLoadingMore) return;
      void fetchTagPosts({ append: true });
      return;
    }
    // Guard for global mode to avoid duplicate fetches
    if (!globalHasMore || globalLoadingMore) return;
    if (!globalCursor) return;
    void fetchGlobalPosts(globalCursor, true);
  }, [
    fetchGlobalPosts,
    fetchTagPosts,
    globalCursor,
    globalHasMore,
    globalLoadingMore,
    tagHasMore,
    tagLoadingMore,
    tagMode,
  ]);

  const posts = tagMode ? tagPosts : globalPosts;
  const loading = tagMode ? tagLoading : globalLoading;
  const loadingMore = tagMode ? tagLoadingMore : globalLoadingMore;
  const hasMore = tagMode ? tagHasMore : globalHasMore;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tag && (
        <div className="shrink-0 px-2 pt-3">
          <div
            className={cn(
              'flex items-center justify-between rounded-md border border-white/5 bg-background/40 px-3 py-2 text-muted-foreground text-xs'
            )}
          >
            {tagMode ? (
              <>
                <span className="min-w-0 truncate">
                  Showing posts for{' '}
                  <span className="font-semibold text-foreground">
                    {tagInfo?.displayName ?? perpTicker}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="shrink-0 rounded px-2 py-1 font-semibold text-foreground/80 hover:bg-muted/20 hover:text-foreground"
                >
                  Show all
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 truncate">Showing all posts</span>
                <button
                  type="button"
                  onClick={restoreTagFilter}
                  className="shrink-0 rounded px-2 py-1 font-semibold text-foreground/80 hover:bg-muted/20 hover:text-foreground"
                >
                  {perpTicker ?? 'Filtered'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
        {loading ? (
          <FeedSkeleton count={6} />
        ) : tagMode && posts.length === 0 && (tagNotFound || tagError) ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
            <span>
              {tagNotFound
                ? `No topic found for ${perpTicker ?? 'this market'}.`
                : 'Could not load posts.'}
            </span>
            <div className="flex gap-2">
              {tagError && (
                <button
                  type="button"
                  onClick={restoreTagFilter}
                  className="rounded px-2 py-1 font-semibold text-foreground/80 hover:bg-muted/20 hover:text-foreground"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded px-2 py-1 font-semibold text-foreground/80 hover:bg-muted/20 hover:text-foreground"
              >
                Show all posts
              </button>
            </div>
          </div>
        ) : posts.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
            No posts yet.
          </div>
        ) : (
          <PostList
            posts={posts}
            actorNames={actorNames}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            density="compact"
          />
        )}
      </div>
    </div>
  );
}
