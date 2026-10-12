/**
 * LOOKUP_USER Action
 *
 * Look up a user by username or display name to get their ID for other actions.
 */

import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { asc, db, ilike, or, sql, users } from '@feed/db';
import { logger } from '../../../../shared/logger';

export const lookupUserAction: Action = {
  name: 'LOOKUP_USER',
  description:
    'Look up a user by username or display name to get their ID. Use the returned userId with CHECK_RECENT_POSTS or CHECK_RECENT_COMMENTS.',
  parameters: {
    username: {
      type: 'string',
      description:
        'Username or display name to search for (e.g., "ThunderGrid" or "tcm0843")',
      required: true,
    },
  } as unknown as Action['parameters'],
  examples: [
    [
      {
        name: 'user',
        content: { text: "Find ThunderGrid's user ID" },
      },
      {
        name: 'assistant',
        content: { text: 'Looking up that user...' },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Who is tcm0843?' },
      },
      {
        name: 'assistant',
        content: { text: "I'll look up that username." },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const actionParams = state?.data?.actionParams as
      | { username?: string }
      | undefined;
    const searchTerm = actionParams?.username?.trim();

    if (!searchTerm) {
      return {
        success: false,
        text: 'Missing username parameter.',
        error: 'Missing username',
      };
    }

    try {
      const selection = {
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        isAgent: users.isAgent,
      };

      // Exact (case-insensitive) username match wins outright.
      const [exactMatch] = await db
        .select(selection)
        .from(users)
        .where(sql`lower(${users.username}) = ${searchTerm.toLowerCase()}`)
        .limit(1);

      // Otherwise substring search on username or display name. LIKE wildcard
      // characters in the search term are escaped so they match literally.
      const likeTerm = `%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`;
      const foundUsers = exactMatch
        ? [exactMatch]
        : await db
            .select(selection)
            .from(users)
            .where(
              or(
                ilike(users.username, likeTerm),
                ilike(users.displayName, likeTerm)
              )
            )
            .orderBy(asc(users.username), asc(users.id))
            .limit(5);

      if (foundUsers.length === 0) {
        return {
          success: true,
          text: `No users found matching "${searchTerm}".`,
          data: { users: [], count: 0 },
          values: { count: 0 },
        };
      }

      logger.info(
        `[LOOKUP_USER] Found ${foundUsers.length} users for "${searchTerm}"`,
        undefined,
        'LookupUser'
      );

      // Only resolve a single userId when the match is unambiguous.
      const resolved =
        exactMatch ?? (foundUsers.length === 1 ? foundUsers[0] : undefined);

      return {
        success: true,
        text: resolved
          ? `Found user matching "${searchTerm}".`
          : `Found ${foundUsers.length} users matching "${searchTerm}". The match is ambiguous; pick one by its id.`,
        data: {
          users: foundUsers.map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            isAgent: u.isAgent,
          })),
          count: foundUsers.length,
          userId: resolved?.id,
        },
        values: {
          count: foundUsers.length,
          userId: resolved?.id,
          username: resolved?.username,
          isAgent: resolved?.isAgent,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[LOOKUP_USER] Error:', errorMsg);

      return {
        success: false,
        text: `Failed to look up user: ${errorMsg}`,
        error: errorMsg,
      };
    }
  },
};
