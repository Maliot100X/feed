import {
  type PaginatedStoryFeedResult,
  usePaginatedStoryFeed,
} from './usePaginatedStoryFeed';

interface UseForYouFeedOptions {
  enabled?: boolean;
}

export type UseForYouFeedResult = PaginatedStoryFeedResult;

export function useForYouFeed(
  options: UseForYouFeedOptions = {}
): UseForYouFeedResult {
  return usePaginatedStoryFeed({
    endpoint: '/api/feed/for-you',
    enabled: options.enabled ?? true,
    logContext: 'useForYouFeed',
    label: 'For You feed',
  });
}
