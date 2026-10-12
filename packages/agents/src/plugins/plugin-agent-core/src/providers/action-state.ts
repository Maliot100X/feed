/**
 * Action State Provider
 *
 * Provides previous action results from the current multi-step execution.
 * Rendering is shared with the coordinator provider and AgentChatService.
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import { buildActionStateProviderResult } from '../../../../services/agent-action-context';

export const actionStateProvider: Provider = {
  name: 'ACTION_STATE',
  description: 'Previous action results from the current execution',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state: State
  ): Promise<ProviderResult> => buildActionStateProviderResult(state),
};
