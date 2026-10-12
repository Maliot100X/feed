import type {
  Evaluator,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { sharedChatContextService } from '@feed/engine';
import { logger } from '../../../shared/logger';

const CACHE_PREFIX = 'shared-chat-context:last-message-count';
const MIN_MESSAGES_BEFORE_REFRESH = 3;
const REFRESH_EVERY_MESSAGES = 10;
const STALE_AFTER_MINUTES = 30;

function resolveChatId(message: Memory, state?: State): string | null {
  const typedMessage = message as Memory & {
    chatId?: string;
    roomId?: string;
  };

  return (
    typedMessage.chatId ??
    typedMessage.roomId ??
    (state?.values?.teamChatId as string | undefined) ??
    null
  );
}

export const sharedChatContextEvaluator: Evaluator = {
  name: 'SHARED_CHAT_CONTEXT_EVALUATOR',
  similes: [
    'group chat summarizer',
    'shared chat memory',
    'conversation context',
  ],
  description:
    'Refreshes compact shared group chat summaries and facts on a low-cost cadence',
  alwaysRun: false,
  examples: [
    {
      prompt:
        'A group chat just spent several turns discussing a login verification request',
      outcome:
        'Refresh shared chat context and capture the compact facts from the recent conversation.',
      messages: [
        {
          name: 'Alice',
          content: {
            text: 'Can you DM me the verification code so I can finish setup?',
          },
        },
        {
          name: 'Bob',
          content: {
            text: 'I shared the docs link and a support note above.',
          },
        },
      ],
    },
  ],

  async validate(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> {
    const chatId = resolveChatId(message, state);
    if (!chatId) {
      return false;
    }

    const cacheKey = `${CACHE_PREFIX}:${chatId}`;
    const currentCount =
      Number((await runtime.getCache<string>(cacheKey)) ?? '0') + 1;
    await runtime.setCache(cacheKey, String(currentCount));

    if (currentCount < MIN_MESSAGES_BEFORE_REFRESH) {
      return false;
    }

    const storedSnapshot =
      await sharedChatContextService.getStoredSnapshot(chatId);
    if (!storedSnapshot) {
      return true;
    }

    const isOnCadence = currentCount % REFRESH_EVERY_MESSAGES === 0;
    const isStale =
      Date.now() - new Date(storedSnapshot.refreshedAt).getTime() >=
      STALE_AFTER_MINUTES * 60_000;

    if (isOnCadence || isStale) {
      logger.info(
        '[sharedChatContextEvaluator] refreshing shared chat context',
        {
          chatId,
          currentCount,
          isOnCadence,
          isStale,
        },
        'SharedChatContextEvaluator'
      );
      return true;
    }

    return false;
  },

  handler: (async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    _callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<void> => {
    void runtime;
    void message;
    void state;
    void _options;
    void _callback;
    void _responses;

    const chatId = resolveChatId(message, state);
    if (!chatId) {
      return;
    }

    await sharedChatContextService.maybeRefreshChatContext(chatId, {
      messageWindowSize: 10,
      factLimit: 5,
      staleAfterMinutes: STALE_AFTER_MINUTES,
      refreshThreshold: REFRESH_EVERY_MESSAGES,
    });
  }) as unknown as Evaluator['handler'],
};
