'use client';

import { HomePageClient } from '@web/app/HomePageClient';

/**
 * Mobile home page — renders HomePageClient directly.
 * Skips the web version's host detection and waitlist check.
 */
export default function MobileHomePage() {
  return <HomePageClient />;
}
