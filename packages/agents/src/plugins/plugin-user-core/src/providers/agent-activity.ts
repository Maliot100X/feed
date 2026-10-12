/**
 * Agent Activity Provider
 *
 * Surfaces recent inter-agent events from the EventBus for the coordinator's
 * context. This gives the coordinator visibility into what agents have done
 * programmatically (dispatches, trades, posts) beyond just team chat messages.
 *
 * Events are published by AgentChatService after each dispatch completes.
 * This provider reads the EventBus history and formats it for the coordinator's
 * decision-making context.
 *
 * The EventBus is process-wide, so history is scoped to the coordinator's own
 * team chat (`state.values.teamChatId`) before limiting. Events without a
 * matching teamChatId (including legacy unscoped events) are never shown.
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import { getEventBus } from '../../../../communication/EventBus';

export const coordinatorAgentActivityProvider: Provider = {
  name: 'AGENT_ACTIVITY',
  description:
    'Recent programmatic agent activities (dispatch results, inter-agent events)',
  dynamic: true,

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    state?: State
  ): Promise<ProviderResult> => {
    const teamChatId = state?.values?.teamChatId;
    if (typeof teamChatId !== 'string' || !teamChatId) {
      return { text: '' };
    }

    const eventBus = getEventBus();
    const recentEvents = eventBus.getHistory('agent.*', 10, (event) => {
      const data = event.data;
      return (
        typeof data === 'object' &&
        data !== null &&
        !Array.isArray(data) &&
        data.teamChatId === teamChatId
      );
    });

    if (recentEvents.length === 0) {
      return { text: '' };
    }

    const formatted = recentEvents
      .map((event) => {
        const data = event.data as Record<string, unknown>;
        const timestamp = (data.timestamp as string) ?? event.timestamp;
        const agent =
          (data.agentUsername as string) ??
          (data.agentId as string) ??
          'unknown';
        const command =
          typeof data.command === 'string' ? data.command.slice(0, 100) : '';
        const response =
          typeof data.response === 'string' ? data.response.slice(0, 200) : '';
        const success = data.success ?? true;

        const timeStr = timestamp
          ? new Date(timestamp as string).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '??:??';

        if (event.type === 'agent.dispatch.result') {
          return `${timeStr} @${agent}: ${success ? '✓' : '✗'} "${command}" → "${response}"`;
        }

        return `${timeStr} ${event.type}: ${JSON.stringify(data).slice(0, 200)}`;
      })
      .join('\n');

    return { text: `## Recent Agent Activity (Programmatic)\n${formatted}` };
  },
};
