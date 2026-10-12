/**
 * Canonical group invite transitions: concurrent accept/decline of one invite
 * produce exactly one transition, and accepting reactivates prior membership.
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { acceptGroupInvite, declineGroupInvite } from '@feed/api';
import {
  and,
  chatParticipants,
  chats,
  db,
  eq,
  groupInvites,
  groupMembers,
  groups,
  inArray,
  messages,
  users,
} from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';

const created = {
  users: [] as string[],
  groups: [] as string[],
  chats: [] as string[],
  invites: [] as string[],
};

async function createUser(): Promise<string> {
  const id = await generateSnowflakeId();
  await db.insert(users).values({
    id,
    username: `inv_${id.slice(-10)}`,
    isActor: false,
    updatedAt: new Date(),
  });
  created.users.push(id);
  return id;
}

async function createGroupWithChat(ownerId: string): Promise<{
  groupId: string;
  chatId: string;
}> {
  const groupId = await generateSnowflakeId();
  const chatId = await generateSnowflakeId();
  await db.insert(groups).values({
    id: groupId,
    name: `Invite test ${groupId}`,
    type: 'user',
    ownerId,
    createdById: ownerId,
    updatedAt: new Date(),
  });
  await db.insert(chats).values({
    id: chatId,
    isGroup: true,
    groupId,
    updatedAt: new Date(),
  });
  created.groups.push(groupId);
  created.chats.push(chatId);
  return { groupId, chatId };
}

async function createInvite(
  groupId: string,
  invitedUserId: string,
  invitedBy: string
): Promise<string> {
  const id = await generateSnowflakeId();
  await db
    .insert(groupInvites)
    .values({ id, groupId, invitedUserId, invitedBy });
  created.invites.push(id);
  return id;
}

describe('group invite service', () => {
  let ownerId: string;

  beforeAll(async () => {
    ownerId = await createUser();
  });

  afterAll(async () => {
    if (created.chats.length > 0) {
      await db.delete(messages).where(inArray(messages.chatId, created.chats));
      await db
        .delete(chatParticipants)
        .where(inArray(chatParticipants.chatId, created.chats));
      await db.delete(chats).where(inArray(chats.id, created.chats));
    }
    if (created.groups.length > 0) {
      await db
        .delete(groupMembers)
        .where(inArray(groupMembers.groupId, created.groups));
      await db.delete(groups).where(inArray(groups.id, created.groups));
    }
    if (created.invites.length > 0) {
      await db
        .delete(groupInvites)
        .where(inArray(groupInvites.id, created.invites));
    }
    await db.delete(users).where(inArray(users.id, created.users));
  });

  it('applies exactly one of concurrent accept and decline', async () => {
    const userId = await createUser();
    const { groupId } = await createGroupWithChat(ownerId);
    const inviteId = await createInvite(groupId, userId, ownerId);

    const results = await Promise.allSettled([
      acceptGroupInvite(userId, inviteId),
      declineGroupInvite(userId, inviteId),
      acceptGroupInvite(userId, inviteId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const [invite] = await db
      .select({ status: groupInvites.status })
      .from(groupInvites)
      .where(eq(groupInvites.id, inviteId));
    const members = await db
      .select({ isActive: groupMembers.isActive })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
      );

    if (invite?.status === 'accepted') {
      expect(members).toEqual([{ isActive: true }]);
    } else {
      expect(invite?.status).toBe('declined');
      expect(members).toEqual([]);
    }
  });

  it('rejects accepting an invite addressed to someone else', async () => {
    const invited = await createUser();
    const intruder = await createUser();
    const { groupId } = await createGroupWithChat(ownerId);
    const inviteId = await createInvite(groupId, invited, ownerId);

    await expect(acceptGroupInvite(intruder, inviteId)).rejects.toThrow(
      'This invite is not for you'
    );
    const [invite] = await db
      .select({ status: groupInvites.status })
      .from(groupInvites)
      .where(eq(groupInvites.id, inviteId));
    expect(invite?.status).toBe('pending');
  });

  it('reactivates a previous inactive membership on accept', async () => {
    const userId = await createUser();
    const { groupId, chatId } = await createGroupWithChat(ownerId);
    await db.insert(groupMembers).values({
      id: await generateSnowflakeId(),
      groupId,
      userId,
      role: 'member',
      isActive: false,
      kickReason: 'User left',
    });
    const inviteId = await createInvite(groupId, userId, ownerId);

    const result = await acceptGroupInvite(userId, inviteId);
    expect(result).toEqual({ groupId, chatId });

    const members = await db
      .select({
        isActive: groupMembers.isActive,
        kickReason: groupMembers.kickReason,
      })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
      );
    expect(members).toEqual([{ isActive: true, kickReason: null }]);
  });
});
