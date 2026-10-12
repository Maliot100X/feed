'use client';

export const dynamic = 'force-dynamic';

import { logger } from '@feed/shared';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
  type?: string;
  isShared?: boolean;
  articleTitle?: string | null;
  byline?: string | null;
  biasScore?: number | null;
  category?: string | null;
}

interface TagInfo {
  id: string;
  displayName: string;
  category: string | null;
}

const MAX_TAGS = 10;
const GROUP_LIMIT = 50;

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; posts: PostData[]; tags: TagInfo[] };

/** Normalize the comma-separated `tags` query value into a bounded slug list. */
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  const slugs = raw
    .split(',')
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  return [...new Set(slugs)].slice(0, MAX_TAGS);
}

export default function GroupedTrendingPage() {
  const searchParams = useSearchParams();
  const tagsKey = parseTags(searchParams.get('tags')).join(',');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey intentionally re-triggers the fetch
  useEffect(() => {
    if (!tagsKey) {
      setState({ status: 'ready', posts: [], tags: [] });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });

    const query = new URLSearchParams({
      tags: tagsKey,
      limit: String(GROUP_LIMIT),
    });

    const load = async () => {
      const response = await fetch(
        apiUrl(`/api/trending/group?${query.toString()}`),
        { signal: controller.signal }
      );
      if (!response.ok) {
        logger.warn(
          'Failed to fetch grouped trending posts',
          { tags: tagsKey, status: response.status },
          'GroupedTrendingPage'
        );
        setState({ status: 'error' });
        return;
      }
      const data = (await response.json()) as {
        posts?: PostData[];
        tags?: TagInfo[];
      };
      if (controller.signal.aborted) return;
      setState({
        status: 'ready',
        posts: data.posts ?? [],
        tags: data.tags ?? [],
      });
    };

    load().catch(() => {
      if (controller.signal.aborted) return;
      setState({ status: 'error' });
    });

    return () => controller.abort();
  }, [tagsKey, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  const tags = state.status === 'ready' ? state.tags : [];
  const headerTitle =
    tags.length > 0
      ? tags.map((t) => t.displayName).join(' · ')
      : 'Grouped Trending';
  const headerCategory = tags[0]?.category ?? null;

  return (
    <TrendingFeedShell title={headerTitle} subtitle={headerCategory}>
      {state.status === 'loading' ? (
        <div className="space-y-4 sm:px-4 sm:py-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : state.status === 'error' ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <h2 className="font-semibold text-xl">Couldn&apos;t load posts</h2>
          <button
            type="button"
            onClick={retry}
            className="rounded-lg bg-primary px-6 py-2 text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </div>
      ) : state.posts.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <h2 className="mb-2 font-semibold text-xl">No posts found</h2>
            <p className="text-muted-foreground">
              No posts found for these trending topics yet.
            </p>
          </div>
        </div>
      ) : (
        <div>
          {state.posts.map((post) => (
            <PostCard key={post.id} post={post} showCommentInputBar={false} />
          ))}
          {state.posts.length < GROUP_LIMIT && (
            <div className="py-4 text-center text-muted-foreground text-xs">
              You&apos;re all caught up.
            </div>
          )}
        </div>
      )}
    </TrendingFeedShell>
  );
}
