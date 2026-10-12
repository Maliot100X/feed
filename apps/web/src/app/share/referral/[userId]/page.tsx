/**
 * Page: /share/referral/[userId]
 * Shareable referral page with OG meta tags
 */

import { db } from '@feed/db';
import type { Metadata } from 'next';
import { cache } from 'react';
import { ShareRedirect } from '../../_components/ShareRedirect';

// Use Node.js runtime for database access
export const runtime = 'nodejs';

interface PageProps {
  params: Promise<{
    userId: string;
  }>;
}

/** Request-scoped read shared by metadata and page (read-only; no writes on GET). */
const getReferrer = cache((userId: string) =>
  db.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      displayName: true,
      referralCode: true,
    },
  })
);

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { userId: rawUserId } = await params;
  // Decode URL-encoded userId (colons in Privy DIDs are encoded as %3A)
  const userId = decodeURIComponent(rawUserId);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://feed.fun';
  const ogImageUrl = `${appUrl}/api/og/referral/${encodeURIComponent(userId)}`;

  const user = await getReferrer(userId);

  if (!user) {
    // User not found - return default metadata
    return {
      title: 'Join Feed',
      description: 'Trade narratives, share the upside',
    };
  }

  const displayName = user.displayName || user.username || 'A Feed Trader';

  return {
    title: `${displayName} invited you to Feed`,
    description: `Join ${displayName} on Feed and start trading narratives. Earn rewards for signing up!`,
    openGraph: {
      title: `${displayName} invited you to Feed`,
      description: 'Trade narratives, share the upside',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `Join ${displayName} on Feed`,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${displayName} invited you to Feed`,
      description: 'Trade narratives, share the upside',
      images: [ogImageUrl],
    },
  };
}

export default async function ShareReferralPage({ params }: PageProps) {
  const { userId: rawUserId } = await params;
  // Decode URL-encoded userId (colons in Privy DIDs are encoded as %3A)
  const userId = decodeURIComponent(rawUserId);

  const user = await getReferrer(userId);
  // /api/users/me resolves `ref` by username first, then referralCode.
  const code = user?.username || user?.referralCode;
  const href = code ? `/?ref=${encodeURIComponent(code)}` : '/';

  // Crawlers read the metadata above; browsers continue to sign-up.
  return <ShareRedirect href={href} label="Continue to Feed" />;
}
