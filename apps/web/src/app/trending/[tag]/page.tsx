'use client';

export const dynamic = 'force-dynamic';

import { logger } from '@feed/shared';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PostCard } from '@/components/posts/PostCard';
import { Skeleton } from '@/components/shared/Skeleton';
import { apiUrl } from '@/utils/api-url';
import { TrendingFeedShell } from '../_components/TrendingFeedShell';

interface PostData {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  authorUsername?: string | null;
  authorProfileImageUrl?: string | null;
  timestamp: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  isLiked?: boolean;
  isShared?: boolean;
}

interface TagInfo {
  name: string;
  displayName: string;
  category?: string | null;
}

interface TrendingTagResponse {
  tag?: TagInfo;
  posts?: PostData[];
}

const PAGE_SIZE = 20;

type InitialState = 'loading' | 'ready' | 'not-found' | 'error';

export default function TrendingTagPage() {
  const params = useParams<{ tag: string }>();
  // Route params arrive URL-encoded; decode exactly once.
  const tag = decodeURIComponent(params.tag);

  const [posts, setPosts] = useState<PostData[]>([]);
  const [tagInfo, setTagInfo] = useState<TagInfo | null>(null);
  const [initialState, setInitialState] = useState<InitialState>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Identifies the current tag/load generation; responses from an older
  // generation (previous tag, superseded reload) are ignored.
  const generationRef = useRef(0);
  const offsetRef = useRef(0);

  const fetchPage = useCallback(
    async (requestOffset: number, signal?: AbortSignal) => {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(requestOffset),
      });
      const response = await fetch(
        apiUrl(`/api/trending/${encodeURIComponent(tag)}?${query.toString()}`),
        { signal }
      );
      if (response.status === 404) {
        logger.warn('Tag not found', { tag }, 'TrendingTagPage');
        return { notFound: true as const };
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as TrendingTagResponse;
      return { notFound: false as const, data };
    },
    [tag]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey intentionally re-triggers the fetch
  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();

    // Clear previous tag's data so it never shows under the new tag.
    setPosts([]);
    setTagInfo(null);
    setHasMore(false);
    setLoadMoreFailed(false);
    setLoadingMore(false);
    setInitialState('loading');
    offsetRef.current = 0;

    fetchPage(0, controller.signal)
      .then((result) => {
        if (generation !== generationRef.current) return;
        if (result.notFound) {
          setInitialState('not-found');
          return;
        }
        const newPosts = result.data.posts ?? [];
        setTagInfo(result.data.tag ?? null);
        setPosts(newPosts);
        offsetRef.current = newPosts.length;
        setHasMore(newPosts.length === PAGE_SIZE);
        setInitialState('ready');
      })
      .catch(() => {
        if (generation !== generationRef.current) return;
        setInitialState('error');
      });

    return () => controller.abort();
  }, [fetchPage, reloadKey]);

  const handleLoadMore = () => {
    if (initialState !== 'ready' || loadingMore || !hasMore) return;
    const generation = generationRef.current;
    const requestOffset = offsetRef.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);

    fetchPage(requestOffset)
      .then((result) => {
        if (generation !== generationRef.current) return;
        if (result.notFound) {
          setHasMore(false);
          return;
        }
        const newPosts = result.data.posts ?? [];
        // Keep server order; drop any posts already shown.
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...newPosts.filter((p) => p?.id && !seen.has(p.id))];
        });
        offsetRef.current = requestOffset + newPosts.length;
        setHasMore(newPosts.length === PAGE_SIZE);
      })
      .catch(() => {
        if (generation !== generationRef.current) return;
        // Keep hasMore so the user can retry.
        setLoadMoreFailed(true);
      })
      .finally(() => {
        if (generation !== generationRef.current) return;
        setLoadingMore(false);
      });
  };

  const headerTitle = tagInfo?.displayName || tag;
  const headerCategory = tagInfo?.category
    ? `${tagInfo.category} · Trending`
    : null;

  return (
    <TrendingFeedShell title={headerTitle} subtitle={headerCategory}>
      {initialState === 'loading' ? (
        <div className="space-y-4 sm:px-4 sm:py-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : initialState === 'error' ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <h2 className="font-semibold text-xl">Couldn&apos;t load posts</h2>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="rounded-lg bg-primary px-6 py-2 text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </div>
      ) : initialState === 'not-found' ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <h2 className="mb-2 font-semibold text-xl">Topic not found</h2>
            <p className="text-muted-foreground">
              There is no trending topic &quot;{tag}&quot;.
            </p>
          </div>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <h2 className="mb-2 font-semibold text-xl">No posts found</h2>
            <p className="text-muted-foreground">
              No posts have been tagged with &quot;{headerTitle}&quot; yet.
            </p>
          </div>
        </div>
      ) : (
        <div>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} showCommentInputBar={false} />
          ))}

          {hasMore ? (
            <div className="py-4 text-center">
              {loadingMore ? (
                <div className="text-muted-foreground text-sm">
                  Loading more posts...
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  {loadMoreFailed && (
                    <p className="text-destructive text-sm" role="alert">
                      Couldn&apos;t load more posts.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    className="rounded-lg bg-primary px-6 py-2 text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {loadMoreFailed ? 'Try again' : 'Load More'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-4 text-center text-muted-foreground text-xs">
              You&apos;re all caught up.
            </div>
          )}
        </div>
      )}
    </TrendingFeedShell>
  );
}
