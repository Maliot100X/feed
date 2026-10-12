/**
 * Reputation Distribution Service
 *
 * @description Distributes forfeited account reputation to successful reporters
 * when content violations (CSAM/scammer) are confirmed. Handles reward
 * allocation based on report evaluation outcomes and ensures fair distribution
 * among valid reporters.
 */

import {
  and,
  asc,
  db,
  eq,
  gte,
  inArray,
  pointsTransactions,
  reports,
  sql,
  type Transaction,
  users,
} from '@feed/db';
import { generateSnowflakeId, logger } from '@feed/shared';
import { ReputationService } from '../reputation-service';

/**
 * Distribute forfeited reputation to successful reporters.
 *
 * When a user is confirmed as CSAM/scammer, their forfeitable reputation
 * (invite + bonus points; earned points are kept) is split equally among the
 * distinct users who successfully reported them in the last 90 days, and
 * removed from the reported user.
 *
 * Runs in one transaction that locks the reported user's row: concurrent or
 * repeated calls cannot distribute the same balance twice (a second call sees
 * the already-forfeited zero balance), and every award, the forfeiture and
 * their ledger rows commit together. The amount distributed equals the
 * amount forfeited exactly.
 */
export async function distributeReputationToReporters(
  reportedUserId: string,
  reason: 'scammer' | 'csam'
): Promise<void> {
  const summary = await db.transaction(async (tx) => {
    const [reportedUser] = await tx
      .select({
        reputationPoints: users.reputationPoints,
        invitePoints: users.invitePoints,
        bonusPoints: users.bonusPoints,
      })
      .from(users)
      .where(eq(users.id, reportedUserId))
      .for('update');

    if (!reportedUser) {
      logger.warn(
        'Reported user not found',
        { reportedUserId },
        'ReputationDistribution'
      );
      return null;
    }

    const forfeitedPoints =
      reportedUser.invitePoints + reportedUser.bonusPoints;
    if (forfeitedPoints <= 0) {
      return { forfeitedPoints: 0, reporters: 0 };
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const successfulReports = await tx
      .select({ id: reports.id, reporterId: reports.reporterId })
      .from(reports)
      .where(
        and(
          eq(reports.reportedUserId, reportedUserId),
          eq(reports.status, 'resolved'),
          eq(reports.category, reason === 'scammer' ? 'spam' : 'inappropriate'),
          gte(reports.createdAt, ninetyDaysAgo)
        )
      )
      .orderBy(asc(reports.createdAt));

    // One share per distinct, existing reporter (earliest report first).
    const firstReportByReporter = new Map<string, string>();
    for (const report of successfulReports) {
      if (
        report.reporterId !== reportedUserId &&
        !firstReportByReporter.has(report.reporterId)
      ) {
        firstReportByReporter.set(report.reporterId, report.id);
      }
    }
    const existingReporters =
      firstReportByReporter.size > 0
        ? new Set(
            (
              await tx
                .select({ id: users.id })
                .from(users)
                .where(inArray(users.id, [...firstReportByReporter.keys()]))
            ).map((row) => row.id)
          )
        : new Set<string>();
    const reporters = [...firstReportByReporter.entries()].filter(
      ([reporterId]) => existingReporters.has(reporterId)
    );

    if (reporters.length > 0) {
      const share = Math.floor(forfeitedPoints / reporters.length);
      const remainder = forfeitedPoints % reporters.length;
      for (const [index, [reporterId, reportId]] of reporters.entries()) {
        const amount = share + (index === 0 ? remainder : 0);
        if (amount <= 0) continue;
        const award = await ReputationService.awardReputationInTx(
          tx,
          reporterId,
          amount,
          'report_reward',
          { reportedUserId, reportId, reason, forfeitedPoints: amount }
        );
        if (!award.success) {
          throw new Error(
            award.error ?? `Failed to award reporter ${reporterId}`
          );
        }
      }
    }

    await forfeitUserPoints(
      tx,
      reportedUserId,
      forfeitedPoints,
      reportedUser.reputationPoints
    );
    return { forfeitedPoints, reporters: reporters.length };
  });

  if (summary) {
    logger.info(
      'Reputation distribution complete',
      { reportedUserId, reason, ...summary },
      'ReputationDistribution'
    );
  }
}

/**
 * Forfeit all invite and bonus points from a user whose row is locked in
 * `tx`, recording the exact before/after reputation in the ledger.
 */
async function forfeitUserPoints(
  tx: Transaction,
  userId: string,
  amount: number,
  pointsBefore: number
): Promise<void> {
  const [updated] = await tx
    .update(users)
    .set({
      invitePoints: 0,
      bonusPoints: 0,
      reputationPoints: sql`GREATEST(0, ${users.reputationPoints} - ${amount})`,
    })
    .where(eq(users.id, userId))
    .returning({ reputationPoints: users.reputationPoints });
  if (!updated) return;

  await tx.insert(pointsTransactions).values({
    id: await generateSnowflakeId(),
    userId,
    amount: updated.reputationPoints - pointsBefore,
    pointsBefore,
    pointsAfter: updated.reputationPoints,
    reason: 'forfeited',
    metadata: JSON.stringify({
      reason: 'csam_or_scammer_confirmed',
      forfeitedAmount: amount,
    }),
  });
}

/**
 * Check if a user should have points distributed (CSAM/scammer confirmed)
 */
export async function shouldDistributePoints(userId: string): Promise<boolean> {
  const [user] = await db
    .select({
      isBanned: users.isBanned,
      isScammer: users.isScammer,
      isCSAM: users.isCSAM,
      invitePoints: users.invitePoints,
      bonusPoints: users.bonusPoints,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return false;
  }

  // Only distribute if user is banned AND marked as scammer or CSAM
  return user.isBanned && (user.isScammer || user.isCSAM);
}
