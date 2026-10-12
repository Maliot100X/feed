import { describe, expect, it } from 'bun:test';
import type { NarrativePost, NarrativeStory } from '@feed/shared';
import { filterStoriesForViewer } from './viewer-moderation';

const post = (
  id: string,
  authorId: string,
  originalAuthorId?: string
): NarrativePost =>
  ({
    id,
    authorId,
    originalPost: originalAuthorId
      ? { id: `${id}-orig`, authorId: originalAuthorId }
      : null,
  }) as NarrativePost;

const story = (key: string, posts: NarrativePost[]): NarrativeStory =>
  ({ storyKey: key, posts }) as NarrativeStory;

describe('filterStoriesForViewer', () => {
  it('drops posts by excluded authors and reposts of their posts', () => {
    const input = [
      story('a', [post('p1', 'blocked'), post('p2', 'ok')]),
      story('b', [post('p3', 'ok', 'blocked')]),
      story('c', [post('p4', 'ok')]),
    ];
    const out = filterStoriesForViewer(input, new Set(['blocked']));
    expect(out.map((s) => s.storyKey)).toEqual(['a', 'c']);
    expect(out[0]?.posts.map((p) => p.id)).toEqual(['p2']);
    // cached input is not mutated
    expect(input[0]?.posts).toHaveLength(2);
  });

  it('keeps post-less stories (e.g. market cards) untouched', () => {
    const input = [story('m', [])];
    expect(filterStoriesForViewer(input, new Set(['x']))).toEqual(input);
  });
});
