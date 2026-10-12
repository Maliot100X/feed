/**
 * Direct executors for SHARE_INFORMATION and REQUEST_PAYMENT actions.
 *
 * SHARE_INFORMATION: Searches messages the agent can currently access (active
 * DM and group chat memberships) for keyword matches and sends the quoted
 * matches to the recipient. Quotes show provenance only; they are not a claim
 * that the content is true.
 *
 * REQUEST_PAYMENT: Sends a labeled payment request as a DM. The recipient can
 * accept (SEND_MONEY) or decline. The deadline is advisory text only; no
 * expiry is tracked and no payment is executed automatically.
 *
 * Both deliver through the canonical `executeDirectMessage` path (existing DM
 * reuse, owner-DM rule, transactional chat creation).
 */

import {
  and,
  chatParticipants,
  chats,
  db,
  desc,
  eq,
  groupMembers,
  groups,
  inArray,
  messages,
  users,
} from '@feed/db';
import { logger } from '../shared/logger';
import { generateSnowflakeId } from '../shared/snowflake';
import { executeDirectMessage } from './DirectExecutors';

const MAX_SHARE_KEYWORDS = 10;
const MAX_KEYWORD_LENGTH = 64;

/** Normalize keywords: trimmed, lowercased, unique, bounded; blanks dropped. */
export function normalizeShareKeywords(keywords: readonly string[]): string[] {
  return [
    ...new Set(
      keywords
        .map((k) => k.toLowerCase().trim().slice(0, MAX_KEYWORD_LENGTH))
        .filter(Boolean)
    ),
  ].slice(0, MAX_SHARE_KEYWORDS);
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface DirectShareInformationParams {
  agentUserId: string;
  recipientId: string;
  keywords: string[];
  context?: string;
  askingPrice?: number;
}

export interface ShareInformationMatch {
  source: 'dm' | 'group_chat' | 'team_chat' | 'post';
  sourceId: string;
  sourceName?: string;
  speaker: string;
  content: string;
  timestamp: Date;
  relevanceScore: number;
}

export interface DirectShareInformationResult {
  success: boolean;
  matchCount: number;
  matches: ShareInformationMatch[];
  sharedWithRecipient: boolean;
  messageId?: string;
  error?: string;
}

export interface DirectRequestPaymentParams {
  agentUserId: string;
  recipientId: string;
  amount: number;
  reason: string;
  deadline?: number;
}

export interface DirectRequestPaymentResult {
  success: boolean;
  requestId?: string;
  error?: string;
}

// ── SHARE_INFORMATION executor ──────────────────────────────────────────────

export async function executeDirectShareInformation(
  params: DirectShareInformationParams
): Promise<DirectShareInformationResult> {
  const { agentUserId, recipientId, keywords, context, askingPrice } = params;
  const cleanRecipientId = recipientId?.trim();
  const empty: DirectShareInformationResult = {
    success: false,
    matchCount: 0,
    matches: [],
    sharedWithRecipient: false,
  };

  if (!cleanRecipientId) return { ...empty, error: 'Recipient ID is required' };
  const terms = normalizeShareKeywords(keywords ?? []);
  if (terms.length === 0)
    return { ...empty, error: 'At least one keyword is required' };

  try {
    const [recipient] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, cleanRecipientId))
      .limit(1);
    if (!recipient) return { ...empty, error: `Recipient not found` };

    const matches: ShareInformationMatch[] = [];
    const seenMessageIds = new Set<string>();

    // Search DMs the agent is still an active participant of
    const dmRows = await db
      .select({
        messageId: messages.id,
        chatId: chatParticipants.chatId,
        content: messages.content,
        sender: messages.senderId,
        time: messages.createdAt,
      })
      .from(chatParticipants)
      .innerJoin(chats, eq(chats.id, chatParticipants.chatId))
      .innerJoin(messages, eq(messages.chatId, chatParticipants.chatId))
      .where(
        and(
          eq(chatParticipants.userId, agentUserId),
          eq(chatParticipants.isActive, true),
          eq(chats.isGroup, false)
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(200);

    for (const row of dmRows) {
      if (seenMessageIds.has(row.messageId)) continue;
      const lc = (row.content ?? '').toLowerCase();
      const hit = terms.filter((t) => lc.includes(t));
      if (hit.length > 0) {
        seenMessageIds.add(row.messageId);
        matches.push({
          source: 'dm',
          sourceId: row.chatId ?? '',
          speaker: row.sender ?? 'unknown',
          content: row.content ?? '',
          timestamp: row.time ?? new Date(),
          relevanceScore: hit.length / terms.length,
        });
      }
    }

    // Search group chats where the agent is an active member (one query)
    const agentGroups = await db
      .select({
        groupId: groupMembers.groupId,
        groupName: groups.name,
        chatId: groups.activeChatId,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.userId, agentUserId),
          eq(groupMembers.isActive, true)
        )
      );

    const groupByChatId = new Map(
      agentGroups
        .filter((g): g is typeof g & { chatId: string } => !!g.chatId)
        .map((g) => [g.chatId, g])
    );
    const groupRows =
      groupByChatId.size === 0
        ? []
        : await db
            .select({
              messageId: messages.id,
              chatId: messages.chatId,
              content: messages.content,
              sender: messages.senderId,
              time: messages.createdAt,
            })
            .from(messages)
            .where(inArray(messages.chatId, [...groupByChatId.keys()]))
            .orderBy(desc(messages.createdAt))
            .limit(200);

    for (const m of groupRows) {
      if (seenMessageIds.has(m.messageId)) continue;
      const g = groupByChatId.get(m.chatId);
      if (!g) continue;
      const lc = (m.content ?? '').toLowerCase();
      const hit = terms.filter((t) => lc.includes(t));
      if (hit.length > 0) {
        seenMessageIds.add(m.messageId);
        matches.push({
          source: 'group_chat',
          sourceId: g.groupId ?? '',
          sourceName: g.groupName ?? undefined,
          speaker: m.sender ?? 'unknown',
          content: m.content ?? '',
          timestamp: m.time ?? new Date(),
          relevanceScore: hit.length / terms.length,
        });
      }
    }

    matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const top = matches.slice(0, 10);

    if (top.length === 0) {
      return { ...empty, success: true, error: 'No matching info found' };
    }

    const lines = top.map(
      (m, i) =>
        `[${i + 1}] (${m.source}) ${m.speaker}: "${m.content.slice(0, 200)}"`
    );
    const price =
      askingPrice && askingPrice > 0 ? `\nAsking price: $${askingPrice}` : '';
    const body =
      `[INTEL SHARE - quoted messages, not verified as true]\nFrom: ${agentUserId}\n` +
      `Keywords: ${terms.join(', ')}\n` +
      `Context: ${context || 'Information share'}\n` +
      `Matches: ${top.length}\n---\n${lines.join('\n')}${price}`;

    const sent = await executeDirectMessage({
      agentUserId,
      recipientId: cleanRecipientId,
      content: body,
    });
    if (!sent.success) {
      return {
        ...empty,
        matchCount: top.length,
        matches: top,
        error: sent.error,
      };
    }
    const messageId = sent.messageId;

    logger.info(
      `[IntelExecutor] SHARE_INFORMATION: ${agentUserId} → ${cleanRecipientId} (${top.length} matches)`,
      { agentUserId, recipientId: cleanRecipientId, matchCount: top.length },
      'IntelPaymentExecutors'
    );

    return {
      success: true,
      matchCount: top.length,
      matches: top,
      sharedWithRecipient: true,
      messageId,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ...empty, error: msg };
  }
}

// ── REQUEST_PAYMENT executor ────────────────────────────────────────────────

export async function executeDirectRequestPayment(
  params: DirectRequestPaymentParams
): Promise<DirectRequestPaymentResult> {
  const { agentUserId, recipientId, amount, reason, deadline } = params;
  const cleanRecipientId = recipientId?.trim();

  if (!cleanRecipientId)
    return { success: false, error: 'Recipient ID required' };
  if (!Number.isFinite(amount) || amount <= 0)
    return { success: false, error: 'Amount must be positive' };
  if (!reason?.trim()) return { success: false, error: 'Reason is required' };
  if (
    deadline !== undefined &&
    (!Number.isSafeInteger(deadline) || deadline <= 0)
  ) {
    return { success: false, error: 'Deadline must be a positive integer' };
  }

  try {
    const [recipient] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, cleanRecipientId))
      .limit(1);
    if (!recipient) return { success: false, error: 'Recipient not found' };

    const requestId = await generateSnowflakeId();
    const dl = deadline ?? 10;

    const body =
      `[PAYMENT REQUEST]\nRequest ID: ${requestId}\n` +
      `From: ${agentUserId}\nAmount: $${amount}\n` +
      `Reason: ${reason}\nRequested within: ${dl} ticks (advisory)\n---\n` +
      `To accept: SEND_MONEY $${amount} to ${agentUserId}\n` +
      `To decline: ignore or counter-offer`;

    const sent = await executeDirectMessage({
      agentUserId,
      recipientId: cleanRecipientId,
      content: body,
    });
    if (!sent.success) {
      return { success: false, error: sent.error };
    }

    logger.info(
      `[IntelExecutor] REQUEST_PAYMENT: ${agentUserId} → ${cleanRecipientId} $${amount}`,
      { agentUserId, recipientId: cleanRecipientId, amount, requestId },
      'IntelPaymentExecutors'
    );

    return { success: true, requestId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}
