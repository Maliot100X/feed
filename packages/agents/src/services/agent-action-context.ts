import type {
  IAgentRuntime,
  Memory,
  ProviderResult,
  State,
} from '@elizaos/core';
import { logger } from '@feed/shared';

/** Action outcome recorded in `state.data.actionResults` during a chat run. */
export interface AgentActionTrace {
  actionType: string;
  success: boolean;
  timestamp: number;
  text?: string;
  error?: string | Error;
  values?: object;
}

function isAgentActionTrace(value: unknown): value is AgentActionTrace {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.actionType === 'string' &&
    typeof obj.timestamp === 'number' &&
    typeof obj.success === 'boolean'
  );
}

/** Preserve the complete outputs of actions for the next decision and summary. */
export function formatAgentActionResults(
  results: ReadonlyArray<{
    actionType: string;
    success: boolean;
    text?: string;
    error?: string | Error;
    values?: object;
  }>
): string {
  if (results.length === 0) return 'No actions taken yet in this request.';
  return results
    .map((result, index) =>
      [
        `${index + 1}. ${result.actionType}: ${result.success ? 'Success' : 'Failed'}`,
        result.text,
        result.error
          ? `Error: ${result.error instanceof Error ? result.error.message : result.error}`
          : undefined,
        result.values ? `Values: ${JSON.stringify(result.values)}` : undefined,
      ]
        .filter((value) => value !== undefined)
        .join('\n')
    )
    .join('\n\n');
}

/** Refuse SDK fuzzy action matching and recheck action eligibility before execution. */
export async function requireAgentAction(
  runtime: IAgentRuntime,
  actionName: string,
  message: Memory,
  state: State
): Promise<void> {
  const matches = runtime.actions.filter(
    (action) => action.name === actionName
  );
  if (matches.length !== 1)
    throw new Error(`Unknown or ambiguous agent action: ${actionName}`);
  const action = matches[0]!;
  if (
    typeof action.handler !== 'function' ||
    typeof action.validate !== 'function'
  ) {
    throw new Error(`Incomplete agent action: ${actionName}`);
  }
  if (!(await action.validate(runtime, message, state)))
    throw new Error(`Agent action is not available: ${actionName}`);
}

/**
 * Shared ACTION_STATE provider body (agent and coordinator plugins): renders
 * `state.data.actionResults` with the same formatter the chat service uses.
 */
export function buildActionStateProviderResult(state: State): ProviderResult {
  const rawResults: unknown = state.data?.actionResults;
  const actionResults = Array.isArray(rawResults)
    ? rawResults.filter(isAgentActionTrace)
    : [];
  if (Array.isArray(rawResults) && actionResults.length !== rawResults.length) {
    logger.warn(
      `Filtered ${rawResults.length - actionResults.length} invalid action results`,
      { totalRaw: rawResults.length, valid: actionResults.length },
      'ActionState'
    );
  }

  const formattedResults = formatAgentActionResults(actionResults);
  const completedCount = actionResults.filter((r) => r.success).length;
  const failedCount = actionResults.length - completedCount;

  return {
    data: {
      actionResults,
      completedCount,
      failedCount,
    },
    values: {
      actionResults: formattedResults,
      hasActionResults: actionResults.length > 0,
      completedActions: completedCount,
      failedActions: failedCount,
      totalActions: actionResults.length,
    },
    text:
      actionResults.length > 0
        ? `# Actions Taken This Request\n\n${formattedResults}`
        : 'No actions taken yet.',
  };
}
