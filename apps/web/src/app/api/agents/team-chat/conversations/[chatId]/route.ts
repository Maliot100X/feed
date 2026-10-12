/**
 * Team Chat Conversation Management API
 *
 * @route PUT /api/agents/team-chat/conversations/[chatId] - Switch to/rename conversation
 * @route DELETE /api/agents/team-chat/conversations/[chatId] - Delete conversation
 */

import { teamChatService } from '@feed/agents';
import { authenticateUser, withErrorHandling } from '@feed/api';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// =============================================================================
// PUT: Switch to conversation or rename it
// =============================================================================

const updateConversationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('switch') }),
  z.object({
    action: z.literal('rename'),
    title: z.string().trim().min(1).max(100),
  }),
]);

export const PUT = withErrorHandling(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> }
  ) => {
    const user = await authenticateUser(req);
    const { chatId } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const parseResult = updateConversationSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const update = parseResult.data;

    if (update.action === 'switch') {
      const teamChat = await teamChatService.switchConversation(
        user.id,
        chatId
      );

      logger.info(
        `Switched conversation`,
        { userId: user.id, chatId },
        'TeamChatConversationsAPI'
      );

      return NextResponse.json({
        success: true,
        activeChatId: teamChat.chatId,
      });
    }

    const { title } = update;
    await teamChatService.renameConversation(user.id, chatId, title);

    logger.info(
      `Renamed conversation`,
      { userId: user.id, chatId, title },
      'TeamChatConversationsAPI'
    );

    return NextResponse.json({
      success: true,
      title,
    });
  }
);

// =============================================================================
// DELETE: Delete conversation
// =============================================================================

export const DELETE = withErrorHandling(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ chatId: string }> }
  ) => {
    const user = await authenticateUser(req);
    const { chatId } = await params;

    const newActiveChatId = await teamChatService.deleteConversation(
      user.id,
      chatId
    );

    logger.info(
      `Deleted conversation`,
      { userId: user.id, chatId, newActiveChatId },
      'TeamChatConversationsAPI'
    );

    return NextResponse.json({
      success: true,
      newActiveChatId,
    });
  }
);
