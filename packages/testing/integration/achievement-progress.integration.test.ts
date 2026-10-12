/**
 * Achievement unlocks are atomic with their reward: concurrent progress checks
 * unlock and pay once.
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { checkProgress } from '@feed/api';
import {
  comments,
  db,
  eq,
  pointsTransactions,
  posts,
  userAchievements,
  userChallengeProgress,
  users,
} from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';

let userId: string;
let postId: string;

describe('achievement progress', () => {
  beforeAll(async () => {
    userId = await generateSnowflakeId();
    postId = await generateSnowflakeId();
    await db.insert(users).values({
      id: userId,
      username: `ach_${userId.slice(-10)}`,
      isActor: false,
      reputationPoints: 0,
      updatedAt: new Date(),
    });
    await db.insert(posts).values({
      id: postId,
      content: 'achievement test post',
      authorId: userId,
    });
    await db.insert(comments).values({
      id: await generateSnowflakeId(),
      postId,
      authorId: userId,
      content: 'first comment',
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(comments).where(eq(comments.postId, postId));
    await db.delete(posts).where(eq(posts.id, postId));
    await db
      .delete(userAchievements)
      .where(eq(userAchievements.userId, userId));
    await db
      .delete(userChallengeProgress)
      .where(eq(userChallengeProgress.userId, userId));
    await db
      .delete(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it('unlocks and rewards once under concurrent progress checks', async () => {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        checkProgress(
          userId,
          { type: 'comment_created' },
          { failOnError: true }
        )
      )
    );

    const unlocked = await db
      .select({ achievementId: userAchievements.achievementId })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    expect(unlocked.map((u) => u.achievementId)).toContain('feed_commenter');

    const awards = await db
      .select({
        reason: pointsTransactions.reason,
        metadata: pointsTransactions.metadata,
      })
      .from(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId));
    const commenterAwards = awards.filter(
      (a) =>
        a.reason === 'achievement_unlock' &&
        a.metadata?.includes('feed_commenter')
    );
    expect(commenterAwards).toHaveLength(1);

    // Ledger and counter agree.
    const [user] = await db
      .select({ reputationPoints: users.reputationPoints })
      .from(users)
      .where(eq(users.id, userId));
    const ledgerTotal = (
      await db
        .select({ amount: pointsTransactions.amount })
        .from(pointsTransactions)
        .where(eq(pointsTransactions.userId, userId))
    ).reduce((sum, row) => sum + row.amount, 0);
    expect(user?.reputationPoints).toBe(ledgerTotal);
  });
});
