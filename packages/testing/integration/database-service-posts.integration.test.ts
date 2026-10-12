/**
 * DatabaseService post helpers preserve post type, count real inserts and
 * return full pages when test-author posts are interleaved.
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db, getDbInstance, inArray, posts, users } from '@feed/db';
import { type FeedPost, generateSnowflakeId } from '@feed/shared';

const postIds: string[] = [];
const userIds: string[] = [];
// Far-future-but-past window so these are the newest posts in the table.
const base = Date.now() - 1000;

describe('DatabaseService posts', () => {
  beforeAll(async () => {
    const realAuthor = await generateSnowflakeId();
    const testAuthor = await generateSnowflakeId();
    await db.insert(users).values([
      {
        id: realAuthor,
        username: `dsp_${realAuthor.slice(-10)}`,
        isActor: false,
        updatedAt: new Date(),
      },
      {
        id: testAuthor,
        username: `dsp_${testAuthor.slice(-10)}`,
        isActor: false,
        isTest: true,
        updatedAt: new Date(),
      },
    ]);
    userIds.push(realAuthor, testAuthor);

    // 6 test-author posts newer than 3 real posts.
    for (let i = 0; i < 9; i++) {
      const id = await generateSnowflakeId();
      postIds.push(id);
      await db.insert(posts).values({
        id,
        content: `post ${i}`,
        authorId: i < 6 ? testAuthor : realAuthor,
        timestamp: new Date(base - i),
      });
    }
  });

  afterAll(async () => {
    await db.delete(posts).where(inArray(posts.id, postIds));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  it('returns a full page of non-test posts', async () => {
    const page = await getDbInstance().getRecentPosts(3);
    expect(page).toHaveLength(3);
    expect(page.every((p) => p.authorId === userIds[0])).toBe(true);
  });

  it('preserves post type and counts only inserted rows', async () => {
    const id = await generateSnowflakeId();
    postIds.push(id);
    const article: FeedPost & { gameId?: string; dayNumber?: number } = {
      id,
      type: 'article',
      content: 'article body',
      author: userIds[0]!,
      authorName: 'Author',
      timestamp: new Date(base - 100).toISOString(),
    };
    const service = getDbInstance();
    const first = await service.createManyPosts([article]);
    const second = await service.createManyPosts([article]);
    expect(first.count).toBe(1);
    expect(second.count).toBe(0);

    const [row] = await db
      .select({ type: posts.type })
      .from(posts)
      .where(inArray(posts.id, [id]));
    expect(row?.type).toBe('article');
  });
});
