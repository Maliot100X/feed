import { expect, test } from 'bun:test';
import { db, eq, pointsTransactions, users } from '@feed/db';
import { ReputationService } from '../../api/src/services/reputation-service';

test('concurrent chat progress awards retain every increment and a continuous ledger', async () => {
  const userId = `chat-reputation-${crypto.randomUUID()}`;
  await db.insert(users).values({
    id: userId,
    username: userId,
    isTest: true,
    reputationPoints: 1000,
    bonusPoints: 0,
    updatedAt: new Date(),
  });
  try {
    await Promise.all(
      [50, 35, 220].map((amount) =>
        ReputationService.awardReputation(userId, amount, 'challenge_complete')
      )
    );
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.reputationPoints).toBe(1305);
    expect(user?.bonusPoints).toBe(305);
    const ledger = await db
      .select()
      .from(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId));
    expect(ledger).toHaveLength(3);
    ledger.sort((a, b) => a.pointsBefore - b.pointsBefore);
    expect(ledger[0]?.pointsBefore).toBe(1000);
    expect(ledger[1]?.pointsBefore).toBe(ledger[0]?.pointsAfter);
    expect(ledger[2]?.pointsBefore).toBe(ledger[1]?.pointsAfter);
    expect(ledger[2]?.pointsAfter).toBe(1305);
  } finally {
    await db
      .delete(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});

test('concurrent one-time awards serialize eligibility with the counter mutation', async () => {
  const userId = `chat-reputation-once-${crypto.randomUUID()}`;
  await db.insert(users).values({
    id: userId,
    username: userId,
    isTest: true,
    reputationPoints: 1000,
    bonusPoints: 0,
    updatedAt: new Date(),
  });
  try {
    await Promise.all(
      [1, 2, 3].map(() =>
        ReputationService.awardReputation(userId, 50, 'profile_completion')
      )
    );
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user?.reputationPoints).toBe(1050);
    const ledger = await db
      .select()
      .from(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId));
    expect(ledger).toHaveLength(1);
  } finally {
    await db
      .delete(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
});
