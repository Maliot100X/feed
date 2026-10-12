/**
 * GET /feed/breaking-news/rss — RSS 2.0 feed of breaking news (world events, org updates, actor posts).
 *
 * Same as /feed/rss — reuses the breaking-news widget handler in-process
 * (anonymously, since RSS output is publicly cached) and converts it to RSS.
 * Limit 20 keeps the feed focused.
 */

import { publicRateLimit } from '@feed/api';
import type { NextRequest } from 'next/server';
import { GET as getBreakingNews } from '@/app/api/feed/widgets/breaking-news/route';
import { loadAnonymousJson } from '@/lib/http/in-process';
import {
  buildRssXml,
  getRssCacheHeaders,
  type RssChannel,
  type RssItem,
} from '@/lib/rss';

interface BreakingNewsItem {
  id: string;
  title: string;
  description?: string;
  fullDescription?: string;
  timestamp: string;
  relatedQuestion?: number;
  relatedPostId?: string;
}

export async function GET(request: NextRequest) {
  const { error } = await publicRateLimit(request);
  if (error) return error;

  const origin = new URL(request.url).origin;
  const limit = 20;

  const data = await loadAnonymousJson<{ news?: BreakingNewsItem[] }>(
    getBreakingNews,
    new URL(`/api/feed/widgets/breaking-news?limit=${limit}`, origin)
  );

  if (!data) {
    return new Response('Breaking news feed temporarily unavailable', {
      status: 502,
    });
  }

  const news = data.news ?? [];
  const items: RssItem[] = news.map((item) => {
    // Only actual posts have a post page; world events and price updates
    // (which may also carry relatedActorId) link to the feed.
    const link = item.relatedPostId
      ? `${origin}/post/${encodeURIComponent(item.relatedPostId)}`
      : `${origin}/feed`;
    return {
      title: item.title,
      link,
      description: item.fullDescription ?? item.description ?? '',
      pubDate: item.timestamp,
    };
  });

  const channel: RssChannel = {
    title: 'Feed Breaking News',
    link: `${origin}/feed`,
    description: 'World events, price updates, and posts from Feed',
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
