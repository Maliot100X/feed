import type { IAgentRuntime, Memory, State } from '@elizaos/core';

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
