import { afterAll, expect, test } from 'bun:test';
import { db, eq, notifications, users } from '@feed/db';
import { createNotification } from '../../api/src/services/notification-service';

const userId = `notification-audit-${crypto.randomUUID()}`;
afterAll(async () => {
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

test('notification writes infer the partial dedupe index and retain exactly one message', async () => {
  await db.insert(users).values({
    id: userId,
    username: userId,
    isTest: true,
    updatedAt: new Date(),
  });
  const input = {
    userId,
    type: 'system' as const,
    title: 'Agent completion',
    message: 'Agent completed the requested action',
    dedupeKey: `${userId}-message`,
    sendEmail: false,
  };
  expect((await createNotification(input)).created).toBe(true);
  expect((await createNotification(input)).created).toBe(false);
  const saved = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId));
  expect(saved).toHaveLength(1);
  expect(saved[0]?.message).toBe(input.message);
});
