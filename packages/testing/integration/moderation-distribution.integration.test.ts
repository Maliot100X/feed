/**
 * Forfeited reputation distribution: one share per distinct reporter, exact
 * conservation, and no double distribution under concurrent calls.
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { distributeReputationToReporters } from '@feed/api';
import { db, eq, inArray, pointsTransactions, reports, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';

const userIds: string[] = [];
let reportedId: string;
let reporterA: string;
let reporterB: string;

async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const id = await generateSnowflakeId();
  await db.insert(users).values({
    id,
    username: `mod_${id.slice(-10)}`,
    isActor: false,
    updatedAt: new Date(),
    ...overrides,
  });
  userIds.push(id);
  return id;
}

async function report(reporterId: string): Promise<void> {
  await db.insert(reports).values({
    id: await generateSnowflakeId(),
    reporterId,
    reportedUserId: reportedId,
    reportType: 'user',
    category: 'spam',
    reason: 'scam attempt',
    status: 'resolved',
    updatedAt: new Date(),
  });
}

describe('distributeReputationToReporters', () => {
  beforeAll(async () => {
    reportedId = await createUser({
      reputationPoints: 1100,
      earnedPoints: 100,
      invitePoints: 300,
      bonusPoints: 701,
    });
    reporterA = await createUser({ reputationPoints: 0 });
    reporterB = await createUser({ reputationPoints: 0 });
    // Reporter A reported twice: still one share.
    await report(reporterA);
    await report(reporterA);
    await report(reporterB);
  });

  afterAll(async () => {
    await db.delete(reports).where(eq(reports.reportedUserId, reportedId));
    await db
      .delete(pointsTransactions)
      .where(inArray(pointsTransactions.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  it('distributes once, per distinct reporter, conserving the forfeited amount', async () => {
    await Promise.all([
      distributeReputationToReporters(reportedId, 'scammer'),
      distributeReputationToReporters(reportedId, 'scammer'),
    ]);

    const rows = await db
      .select({
        id: users.id,
        reputationPoints: users.reputationPoints,
        invitePoints: users.invitePoints,
        bonusPoints: users.bonusPoints,
      })
      .from(users)
      .where(inArray(users.id, [reportedId, reporterA, reporterB]));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // 1001 forfeitable points split between two distinct reporters.
    expect(byId[reporterA]?.reputationPoints).toBe(501);
    expect(byId[reporterB]?.reputationPoints).toBe(500);
    expect(byId[reportedId]).toMatchObject({
      reputationPoints: 99,
      invitePoints: 0,
      bonusPoints: 0,
    });
  });
});
