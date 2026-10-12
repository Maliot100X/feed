/**
 * Admin Group Invite API
 *
 * @route POST /api/admin/group-invite - Send NPC group invite
 * @access Admin
 *
 * @description
 * Adds a user to an existing NPC-owned group chat on behalf of that NPC and
 * notifies them. Admin only. The chat must already exist, be a group chat and
 * belong to a group of type `npc` owned by `npcId`; this route never creates
 * groups/chats or rebinds an existing chat to a different group. When
 * `chatId` is omitted the NPC must own exactly one group chat.
 *
 * @openapi
 * /api/admin/group-invite:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Send NPC group invite
 *     description: Sends group chat invite from NPC to user (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - npcId
 *               - userId
 *             properties:
 *               npcId:
 *                 type: string
 *                 description: NPC actor ID
 *               userId:
 *                 type: string
 *                 description: Target user ID
 *               chatId:
 *                 type: string
 *                 description: Existing NPC-owned group chat ID (optional when the NPC owns exactly one)
 *     responses:
 *       200:
 *         description: Invite sent successfully
 *       400:
 *         description: Invalid input, chat not owned by the NPC, already a member, or group limit reached
 *       404:
 *         description: NPC, user or NPC group chat not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * await fetch('/api/admin/group-invite', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${adminToken}` },
 *   body: JSON.stringify({
 *     npcId: 'npc-id',
 *     userId: 'user-id',
 *     chatId: 'chat-id'
 *   })
 * });
 * ```
 */

import {
  getClientIp,
  logAdminModify,
  notifyGroupChatInvite,
  requireAdmin,
  withErrorHandling,
} from '@feed/api';
import {
  asSystem,
  chatParticipants,
  generateSnowflakeId,
  groupMembers,
  sql,
} from '@feed/db';
import { StaticDataRegistry } from '@feed/engine';
import { GROUP_CONFIG } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const GroupInviteSchema = z.object({
  npcId: z.string().trim().min(1, 'npcId is required'),
  userId: z.string().trim().min(1, 'userId is required'),
  chatId: z.string().trim().min(1).optional(),
});

type TargetChat = { chatId: string; chatName: string; groupId: string };
type TargetChatResult =
  | { ok: true; chat: TargetChat }
  | { ok: false; error: string; status: number };

/**
 * Resolve the existing NPC-owned group chat to add the user to.
 * Never creates or rebinds chats/groups.
 */
async function resolveNpcGroupChat(
  npcId: string,
  chatId: string | undefined
): Promise<TargetChatResult> {
  return asSystem(async (db) => {
    if (chatId) {
      const chat = await db.chat.findUnique({
        where: { id: chatId },
        select: { id: true, name: true, isGroup: true, groupId: true },
      });
      if (!chat) {
        return { ok: false, error: 'Chat not found', status: 404 };
      }
      if (!chat.isGroup || !chat.groupId) {
        return { ok: false, error: 'Chat is not a group chat', status: 400 };
      }
      const group = await db.group.findUnique({
        where: { id: chat.groupId },
        select: { type: true, ownerId: true, name: true },
      });
      if (!group || group.type !== 'npc' || group.ownerId !== npcId) {
        return {
          ok: false,
          error: 'Chat does not belong to a group owned by this NPC',
          status: 400,
        };
      }
      return {
        ok: true,
        chat: {
          chatId: chat.id,
          chatName: chat.name ?? group.name,
          groupId: chat.groupId,
        },
      };
    }

    const npcGroups = await db.group.findMany({
      where: { ownerId: npcId, type: 'npc' },
      select: { id: true, name: true },
    });
    if (npcGroups.length === 0) {
      return { ok: false, error: 'NPC has no group chat', status: 404 };
    }
    const groupChats = await db.chat.findMany({
      where: { groupId: { in: npcGroups.map((g) => g.id) }, isGroup: true },
      select: { id: true, name: true, groupId: true },
    });
    if (groupChats.length === 0) {
      return { ok: false, error: 'NPC has no group chat', status: 404 };
    }
    if (groupChats.length > 1) {
      return {
        ok: false,
        error: 'NPC owns multiple group chats; chatId is required',
        status: 400,
      };
    }
    const [chat] = groupChats;
    const group = npcGroups.find((g) => g.id === chat?.groupId);
    if (!chat?.groupId || !group) {
      return { ok: false, error: 'NPC has no group chat', status: 404 };
    }
    return {
      ok: true,
      chat: {
        chatId: chat.id,
        chatName: chat.name ?? group.name,
        groupId: chat.groupId,
      },
    };
  });
}

/**
 * POST /api/admin/group-invite
 * Add a user to an existing NPC-owned group chat and notify them.
 * Admin only.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const admin = await requireAdmin(request);

  const parsed = GroupInviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }
  const { npcId, userId, chatId } = parsed.data;

  // Verify NPC exists
  const staticActor = StaticDataRegistry.getActor(npcId);
  const npc = staticActor
    ? { id: staticActor.id, name: staticActor.name }
    : await asSystem(async (db) => {
        return await db.user.findUnique({
          where: { id: npcId, isActor: true },
          select: { id: true, displayName: true, username: true },
        });
      });

  if (!npc) {
    return NextResponse.json({ error: 'NPC not found' }, { status: 404 });
  }

  // Verify user exists
  const targetUser = await asSystem(async (db) => {
    return await db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true },
    });
  });

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const target = await resolveNpcGroupChat(npcId, chatId);
  if (!target.ok) {
    return NextResponse.json(
      { error: target.error },
      { status: target.status }
    );
  }
  const { chatId: finalChatId, chatName, groupId } = target.chat;

  // Check if user is already a member of the verified group
  const existingMembership = await asSystem(async (db) =>
    db.groupMember.findFirst({
      where: { groupId, userId, isActive: true },
    })
  );

  if (existingMembership) {
    return NextResponse.json(
      { error: 'User is already a member of this group' },
      { status: 400 }
    );
  }

  // Check if user is at the NPC group limit (consistent with regular accept flow)
  const npcGroupCount = await asSystem(async (db) => {
    const memberships = await db.groupMember.findMany({
      where: {
        userId,
        isActive: true,
      },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return 0;
    const npcGroups = await db.group.count({
      where: {
        id: { in: groupIds },
        type: 'npc',
      },
    });
    return npcGroups;
  });

  if (npcGroupCount >= GROUP_CONFIG.MAX_ACTIVE_USER_GROUPS) {
    return NextResponse.json(
      {
        error: `User is already in ${GROUP_CONFIG.MAX_ACTIVE_USER_GROUPS} NPC groups. They must leave a group first.`,
      },
      { status: 400 }
    );
  }

  const npcName =
    'name' in npc ? npc.name : npc.displayName || npc.username || 'Unknown';

  const participantId = await generateSnowflakeId();
  const memberId = await generateSnowflakeId();

  await asSystem(async (db) => {
    await db.transaction(async (tx) => {
      const now = new Date();

      await tx
        .insert(chatParticipants)
        .values({
          id: participantId,
          chatId: finalChatId,
          userId,
          joinedAt: now,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [chatParticipants.chatId, chatParticipants.userId],
          set: {
            isActive: true,
            joinedAt: now,
          },
        });

      await tx
        .insert(groupMembers)
        .values({
          id: memberId,
          groupId,
          userId,
          role: 'member',
          addedBy: npcId,
          joinedAt: now,
          isActive: true,
          messageCount: 0,
          qualityScore: 1.0,
        })
        .onConflictDoUpdate({
          target: [groupMembers.groupId, groupMembers.userId],
          set: {
            isActive: true,
            role: 'member',
            addedBy: npcId,
            joinedAt: now,
            kickedAt: sql`NULL`,
            kickReason: sql`NULL`,
          },
        });
    });
  });

  await logAdminModify({
    adminId: admin.userId,
    ipAddress: getClientIp(request.headers) ?? undefined,
    resourceType: 'group_invite',
    resourceId: groupId,
    metadata: {
      action: 'send_group_invite',
      npcId,
      userId,
      chatId: finalChatId,
    },
  });

  // Send notification to user (admin adds are immediate, no inviteId needed)
  await notifyGroupChatInvite(userId, npcId, groupId, chatName);

  return NextResponse.json({
    success: true,
    message: `Invited ${targetUser.displayName || targetUser.username} to ${chatName}`,
    data: {
      chatId: finalChatId,
      chatName,
      npcId,
      npcName,
      userId,
    },
  });
});
