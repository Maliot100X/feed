import { describe, expect, it } from 'bun:test';
import { getStoryFeedSseChannel } from './usePaginatedStoryFeed';

describe('paginated story feed auth readiness guards', () => {
  it('subscribes to feed SSE only after auth is ready', () => {
    expect(getStoryFeedSseChannel(true, false)).toBeNull();
    expect(getStoryFeedSseChannel(false, true)).toBeNull();
    expect(getStoryFeedSseChannel(true, true)).toBe('feed');
  });
});
