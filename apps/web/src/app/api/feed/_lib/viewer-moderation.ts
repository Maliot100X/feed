import {
  getBlockedByUserIds,
  getBlockedUserIds,
  getMutedUserIds,
} from '@feed/db';
import type { NarrativeStory } from '@feed/shared';

/**
 * Authors the viewer must not see: users they blocked or muted, and users who
 * blocked them. Failures propagate — moderation filters are never replaced
 * by an empty (unfiltered) fallback.
 */
export async function loadViewerExcludedAuthorIds(
  viewerId: string
): Promise<Set<string>> {
  const [blocked, muted, blockedBy] = await Promise.all([
    getBlockedUserIds(viewerId),
    getMutedUserIds(viewerId),
    getBlockedByUserIds(viewerId),
  ]);
  return new Set([...blocked, ...muted, ...blockedBy]);
}

/**
 * Remove posts by excluded authors (including reposts/quotes of their posts)
 * from globally cached stories, dropping stories left with no posts.
 * Pure: returns new story objects and never mutates cached inputs.
 */
export function filterStoriesForViewer(
  stories: NarrativeStory[],
  excludedAuthorIds: ReadonlySet<string>
): NarrativeStory[] {
  if (excludedAuthorIds.size === 0) return stories;
  const result: NarrativeStory[] = [];
  for (const story of stories) {
    const visiblePosts = story.posts.filter(
      (post) =>
        !excludedAuthorIds.has(post.authorId) &&
        !(
          post.originalPost && excludedAuthorIds.has(post.originalPost.authorId)
        )
    );
    if (story.posts.length > 0 && visiblePosts.length === 0) continue;
    result.push(
      visiblePosts.length === story.posts.length
        ? story
        : { ...story, posts: visiblePosts }
    );
  }
  return result;
}
