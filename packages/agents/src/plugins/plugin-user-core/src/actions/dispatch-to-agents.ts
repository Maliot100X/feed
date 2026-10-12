/**
 * DISPATCH_TO_AGENTS Action (Parallel Multi-Agent Dispatch)
 *
 * Allows the coordinator to dispatch commands to multiple agents simultaneously.
 * All dispatches run in parallel via Promise.allSettled with per-agent timeouts.
 *
 * Used for multi-agent orchestration patterns:
 * - "Ask all my agents for their market outlook"
 * - "Have trading and research agents coordinate on a strategy"
 * - "Get portfolio status from all agents"
 *
 * Implementation follows the same patterns as dispatch-to-agent.ts:
 * - broadcastFn injected via state.data from the route layer
 * - Returns ActionResult AND calls _callback (so processActions can relay the result)
 * - actionParams passed via state.data.actionParams
 */

import type {
  Action,
  ActionResult,
  Content,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import {
  type BroadcastFn,
  dispatchAgentChat,
} from '../../../../services/AgentChatService';
import { validateDispatches } from './dispatch-validation';

/** Per-agent dispatch timeout — prevents one slow agent from blocking all others */
const DISPATCH_TIMEOUT_MS = 15_000;

interface AgentDispatchResult {
  agentId: string;
  agentUsername?: string;
  success: boolean;
  response: string;
  actionsExecuted: number;
  error?: string;
}

/** Raised when the wait for an agent ends; the agent may still be acting. */
class DispatchWaitTimeoutError extends Error {}

export const dispatchToAgentsAction: Action = {
  name: 'DISPATCH_TO_AGENTS',
  description:
    'Dispatch commands to multiple agents simultaneously. Use when the user wants input from several agents, or when a task benefits from parallel agent work.',

  // Parameters defined as plain object for Feed's dispatch system.
  // Cast needed: alpha elizaos expects ActionParameter[] (protobuf array).
  parameters: {
    dispatches: {
      type: 'array',
      required: true,
      description:
        'Array of dispatch objects, each with agentId and command. Example: [{"agentId": "abc", "command": "check positions"}, {"agentId": "def", "command": "analyze trends"}]',
    },
  } as unknown as Action['parameters'],

  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Ask all my agents what they think about the market',
        },
      },
      {
        name: 'coordinator',
        content: {
          text: "I'll dispatch to all your agents simultaneously to gather their market views.",
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Have my agents coordinate on a trading strategy' },
      },
      {
        name: 'coordinator',
        content: {
          text: "I'll ask all agents for their analysis in parallel, then synthesize a strategy.",
        },
      },
    ],
  ],

  // Only show when team has at least 2 agents (single agent → use DISPATCH_TO_AGENT)
  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state?: State
  ): Promise<boolean> => {
    interface TeamMember {
      isAgent: boolean;
    }
    const members =
      (state?.data?.teamMembers as TeamMember[] | undefined) ?? [];
    return members.filter((m) => m.isAgent).length >= 2;
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state?: State,
    _options?: Record<string, unknown>,
    _callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const actionParams = state?.data?.actionParams as
      | { dispatches?: unknown }
      | undefined;

    const broadcastFn = state?.data?.broadcastFn as BroadcastFn | undefined;
    const ownerId = state?.values?.ownerId as string | undefined;
    const teamChatId = state?.values?.teamChatId as string | undefined;
    const ownerName = state?.values?.ownerName as string | undefined;
    const ownerUsername = state?.values?.ownerUsername as string | undefined;

    if (!ownerId || !teamChatId || !broadcastFn) {
      const failResult = {
        success: false,
        text: 'Missing required parameters for multi-agent dispatch. Provide an array of {agentId, command} objects.',
      };
      await _callback?.({ content: failResult as unknown as Content });
      return failResult as unknown as ActionResult;
    }

    const validation = validateDispatches(actionParams?.dispatches);
    if (!validation.ok) {
      const failResult = {
        success: false,
        text: `Invalid dispatch request: ${validation.error}`,
      };
      await _callback?.({ content: failResult as unknown as Content });
      return failResult as unknown as ActionResult;
    }
    const cappedDispatches = validation.dispatches;

    const raceWithTimeout = async <T>(promise: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new DispatchWaitTimeoutError(
              `No response within ${DISPATCH_TIMEOUT_MS / 1000}s; the agent may still be acting (outcome unknown)`
            )
          );
        }, DISPATCH_TIMEOUT_MS);
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    // Execute all dispatches in parallel with per-agent timeout
    const settledResults = await Promise.allSettled(
      cappedDispatches.map(({ agentId, command }) =>
        raceWithTimeout(
          dispatchAgentChat({
            agentId,
            ownerId,
            message: command,
            teamChatId,
            ownerName,
            ownerUsername,
            broadcastFn,
          })
        )
      )
    );

    // Collect results
    const agentResults: AgentDispatchResult[] = settledResults.map(
      (settled, i) => {
        const dispatch = cappedDispatches[i]!;
        if (settled.status === 'fulfilled') {
          const result = settled.value;
          return {
            agentId: result.agentId,
            agentUsername: result.agentUsername,
            success: result.success,
            response: result.response,
            actionsExecuted: result.actionsExecuted,
            error: result.error,
          };
        }
        return {
          agentId: dispatch.agentId,
          success: false,
          response: '',
          actionsExecuted: 0,
          error:
            settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason),
        };
      }
    );

    const successCount = agentResults.filter((r) => r.success).length;
    const pendingCount = settledResults.filter(
      (settled) =>
        settled.status === 'rejected' &&
        settled.reason instanceof DispatchWaitTimeoutError
    ).length;
    const totalCount = agentResults.length;

    // Build summary text
    const summaryParts = agentResults.map((r) => {
      const label = r.agentUsername ? `@${r.agentUsername}` : r.agentId;
      if (r.success) {
        return `${label}: "${r.response.slice(0, 300)}"`;
      }
      return `${label}: NOT CONFIRMED — ${r.error ?? 'Unknown error'}`;
    });

    const finalResult = {
      success: successCount > 0,
      text: `Dispatched to ${totalCount} agents (${successCount} succeeded${pendingCount > 0 ? `, ${pendingCount} still running/unknown` : ''}):\n\n${summaryParts.join('\n\n')}`,
      values: {
        agentResults,
        successCount,
        pendingCount,
        totalCount,
      },
    } as unknown as ActionResult;
    await _callback?.({ content: finalResult as unknown as Content });
    return finalResult;
  },
};
