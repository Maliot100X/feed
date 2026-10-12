import { useCallback, useState } from 'react';
import {
  type PaginatedStoryFeedResult,
  type StoryFeedPage,
  usePaginatedStoryFeed,
} from './usePaginatedStoryFeed';

interface UseStoriesFeedOptions {
  enabled?: boolean;
}

export interface StoriesTopic {
  topicKey: string;
  topicLabel: string;
  summary: string;
}

export interface UseStoriesFeedResult extends PaginatedStoryFeedResult {
  topic: StoriesTopic | null;
}

interface StoriesFeedPage extends StoryFeedPage {
  topic?: StoriesTopic | null;
}

export function useStoriesFeed(
  options: UseStoriesFeedOptions = {}
): UseStoriesFeedResult {
  const [topic, setTopic] = useState<StoriesTopic | null>(null);
  const feed = usePaginatedStoryFeed<StoriesFeedPage>({
    endpoint: '/api/feed/stories',
    enabled: options.enabled ?? true,
    logContext: 'useStoriesFeed',
    label: 'Stories feed',
    onFirstPage: useCallback((page: StoriesFeedPage) => {
      setTopic(page.topic ?? null);
    }, []),
  });
  return { ...feed, topic };
}
