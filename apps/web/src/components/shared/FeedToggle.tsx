'use client';

import { cn } from '@feed/shared';

/**
 * Feed toggle component for switching between feed views.
 *
 * Tab order: For You → Following → Latest → Stories
 * Default: For You
 */
type FeedToggleTab = 'forYou' | 'stories' | 'latest' | 'following';

interface FeedToggleProps {
  activeTab: FeedToggleTab;
  onTabChange: (tab: FeedToggleTab) => void;
}

const TABS: ReadonlyArray<{ id: FeedToggleTab; label: string }> = [
  { id: 'forYou', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'latest', label: 'Latest' },
  { id: 'stories', label: 'Stories' },
];

export function FeedToggle({ activeTab, onTabChange }: FeedToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Feed"
      className="flex w-full items-center border-border border-b"
    >
      {TABS.map((tab) => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'relative flex-1 py-3.5 font-semibold transition-all hover:bg-muted/20',
              selected ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {tab.label}
            {selected && (
              <div className="absolute right-0 bottom-0 left-0 h-[3px] bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
