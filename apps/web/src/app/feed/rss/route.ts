/**
 * GET /feed/rss — RSS 2.0 feed of hot posts.
 *
 * Reuses the /api/feed/hot handler in-process (anonymously — the RSS output
 * is publicly cached) so filtering and scoring live in one place; this route
 * only converts JSON → RSS. Limit 50 for a full page of items.
 */

import { publicRateLimit } from '@feed/api';
import type { NextRequest } from 'next/server';
import { GET as getHotPosts } from '@/app/api/feed/hot/route';
import { loadAnonymousJson } from '@/lib/http/in-process';
import {
  buildRssXml,
  getRssCacheHeaders,
  type RssChannel,
  type RssItem,
} from '@/lib/rss';

export async function GET(request: NextRequest) {
  const { error } = await publicRateLimit(request);
  if (error) return error;

  const origin = new URL(request.url).origin;
  const limit = 50;

  const data = await loadAnonymousJson<{
    posts?: Array<{
      id: string;
      content: string;
      authorName: string;
      timestamp: string;
    }>;
  }>(getHotPosts, new URL(`/api/feed/hot?limit=${limit}`, origin));

  if (!data) {
    // WHY 502: Upstream feed source failed; caller should retry later.
    return new Response('Feed temporarily unavailable', { status: 502 });
  }

  const posts = data.posts ?? [];
  // WHY 80/500: Keep title and description short for RSS readers; full content is at link.
  const items: RssItem[] = posts.map((post) => ({
    title: `${post.authorName}: ${post.content.slice(0, 80)}${post.content.length > 80 ? '…' : ''}`,
    link: `${origin}/post/${post.id}`,
    description:
      post.content.slice(0, 500) + (post.content.length > 500 ? '…' : ''),
    pubDate: post.timestamp,
  }));

  const channel: RssChannel = {
    title: 'Feed',
    link: `${origin}/feed`,
    description: 'Hot posts from Feed',
    siteUrl: origin,
  };

  const xml = buildRssXml(channel, items);

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      ...getRssCacheHeaders(),
    },
  });
}
