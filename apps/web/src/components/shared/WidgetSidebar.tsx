'use client';

import { useEffect, useRef, useState } from 'react';
import { EntitySearchAutocomplete } from '@/components/explore/EntitySearchAutocomplete';
import { LatestNewsPanel } from '@/components/feed/LatestNewsPanel';
import { MarketsPanel } from '@/components/feed/MarketsPanel';
import { TrendingPanel } from '@/components/feed/TrendingPanel';

interface WidgetSidebarProps {
  showLatestNews?: boolean;
  showTrending?: boolean;
  showMarkets?: boolean;
}

/**
 * Widget sidebar component for desktop layouts.
 *
 * Provides a sticky sidebar with search, latest news, trending, and markets
 * panels. Implements smart scrolling behavior on XL+ screens where the sidebar
 * translates vertically as the user scrolls to keep content visible. On smaller
 * screens, the sidebar is hidden.
 *
 * Features:
 * - Entity search autocomplete
 * - Latest news panel (optional)
 * - Trending panel (optional)
 * - Markets panel (optional)
 * - Smart sticky scrolling on XL+ screens
 *
 * @returns Widget sidebar element (hidden on screens < XL)
 */
export function WidgetSidebar({
  showLatestNews = true,
  showTrending = true,
  showMarkets = true,
}: WidgetSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    // Smart sticky behaviour only applies on xl+ screens; the listener stays
    // attached so resizing across the breakpoint enables/resets it.
    const desktop = window.matchMedia('(min-width: 1280px)');
    let frame: number | null = null;

    const resetStyles = () => {
      inner.style.position = '';
      inner.style.top = '';
      inner.style.transform = '';
    };

    const updateSidebar = () => {
      frame = null;
      if (!desktop.matches) {
        resetStyles();
        return;
      }
      const scrollTop = document.scrollingElement?.scrollTop || 0;
      const viewportHeight = window.innerHeight;
      const sidebarHeight = inner.offsetHeight;

      // Top offset from the container's viewport position so fixed
      // positioning stays aligned with any shell content above.
      const topOffset = Math.max(0, container.getBoundingClientRect().top);
      inner.style.position = 'fixed';
      inner.style.top = `${topOffset}px`;

      if (sidebarHeight <= viewportHeight) {
        // Fits: simple sticky to the visible top offset.
        inner.style.transform = '';
        return;
      }
      // Taller than the viewport: translate with scroll until the sidebar's
      // bottom reaches the viewport bottom.
      const maxTranslate = sidebarHeight - (viewportHeight - topOffset);
      const translateY = Math.min(scrollTop, maxTranslate);
      inner.style.transform = `translateY(-${translateY}px)`;
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(updateSidebar);
    };

    updateSidebar();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    desktop.addEventListener('change', schedule);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      desktop.removeEventListener('change', schedule);
    };
  }, []);

  return (
    <div ref={containerRef} className="hidden w-96 flex-none flex-col xl:flex">
      <div ref={innerRef} className="flex w-96 flex-col gap-6 px-4 py-6">
        <div className="flex-shrink-0">
          <EntitySearchAutocomplete
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search users..."
            searchType="users"
          />
        </div>

        {showLatestNews && (
          <div className="flex-shrink-0">
            <LatestNewsPanel />
          </div>
        )}

        {showTrending && (
          <div className="flex-shrink-0">
            <TrendingPanel />
          </div>
        )}

        {showMarkets && (
          <div className="flex-shrink-0">
            <MarketsPanel />
          </div>
        )}
      </div>
    </div>
  );
}
