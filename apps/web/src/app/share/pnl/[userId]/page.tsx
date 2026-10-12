/**
 * Page: /share/pnl/[userId]
 * Shareable P&L page with OG meta tags
 */

import { db } from '@feed/db';
import type { Metadata } from 'next';
import { ShareRedirect } from '../../_components/ShareRedirect';

// Use Node.js runtime for database access
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{
    userId: string;
  }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { userId: rawUserId } = await params;
  const userId = decodeURIComponent(rawUserId);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      displayName: true,
    },
  });

  if (!user) {
    return {
      title: 'Feed',
      description: 'Trading narratives, sharing the upside',
    };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://feed.fun';
  const ogImageUrl = `${appUrl}/api/og/pnl/${encodeURIComponent(userId)}`;
  const displayName = user.displayName || user.username || 'Feed User';

  return {
    title: `${displayName}'s P&L on Feed`,
    description: `Check out ${displayName}'s trading performance on Feed. Trading narratives, sharing the upside.`,
    openGraph: {
      title: `${displayName}'s P&L on Feed`,
      description: 'Trading narratives, sharing the upside',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${displayName}'s P&L`,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${displayName}'s P&L on Feed`,
      description: 'Trading narratives, sharing the upside',
      images: [ogImageUrl],
    },
  };
}

export default function SharePnLPage() {
  // Crawlers read the metadata above; browsers continue to markets.
  return <ShareRedirect href="/markets" label="Continue to Feed markets" />;
}
