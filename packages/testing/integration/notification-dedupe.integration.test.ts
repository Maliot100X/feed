/**
 * Reply notifications: distinct replies to the same comment each notify;
 * a retried notification for the same reply does not duplicate.
 * Group chat invites go through createNotification (block checks).
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { notifyGroupChatInvite, notifyReplyToComment } from '@feed/api';
import {
  and,
  db,
  eq,
  inArray,
  notifications,
  userBlocks,
  users,
} from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';

const userIds: string[] = [];

async function createUser(): Promise<string> {
  const id = await generateSnowflakeId();
  await db.insert(users).values({
    id,
    username: `ntf_${id.slice(-10)}`,
    isActor: false,
    updatedAt: new Date(),
  });
  userIds.push(id);
  return id;
}

describe('notification creation', () => {
  let author: string;
  let replier: string;

  beforeAll(async () => {
    author = await createUser();
    replier = await createUser();
  });

  afterAll(async () => {
    await db
      .delete(notifications)
      .where(inArray(notifications.userId, userIds));
    await db.delete(userBlocks).where(inArray(userBlocks.blockerId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  it('notifies once per reply, not once per parent comment', async () => {
    const postId = await generateSnowflakeId();
    const parent = await generateSnowflakeId();
    const reply1 = await generateSnowflakeId();
    const reply2 = await generateSnowflakeId();

    await notifyReplyToComment(author, replier, postId, parent, reply1);
    await notifyReplyToComment(author, replier, postId, parent, reply2);
    await notifyReplyToComment(author, replier, postId, parent, reply2); // retry

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(eq(notifications.userId, author), eq(notifications.type, 'reply'))
      );
    expect(rows).toHaveLength(2);
  });

  it('does not deliver group chat invites from a blocked user', async () => {
    const invitee = await createUser();
    const inviter = await createUser();
    await db.insert(userBlocks).values({
      id: await generateSnowflakeId(),
      blockerId: invitee,
      blockedId: inviter,
    });

    await notifyGroupChatInvite(invitee, inviter, null, 'Blocked chat');

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, invitee));
    expect(rows).toHaveLength(0);
  });
});
