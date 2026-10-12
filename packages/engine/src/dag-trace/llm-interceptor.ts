/**
 * LLM call interceptor for DAG tracing.
 *
 * Hooks into the global LLM call callback to capture full prompt/response
 * text and associate it with the current active DAG node.
 *
 * Also installs the agent LLM bridge so that LLM calls from @feed/agents
 * (callGroqDirect, callAgentLLM, etc.) are forwarded into the active trace.
 */

import { type AgentLLMBridgeData, setAgentLLMBridge } from '@feed/shared';

import { getActiveTracer } from './tracer';
import type { LLMCallInput } from './types';

/**
 * Callback type matching the shape emitted by openai-client.ts after each LLM call.
 */
export type LLMCallCallback = (call: LLMCallInput) => void;

let globalLLMCallCallback: LLMCallCallback | null = null;

/**
 * Set the global LLM call callback.
 * Called by the dag-trace init to start capturing LLM calls.
 */
export function setLLMCallCallback(callback: LLMCallCallback | null): void {
  globalLLMCallCallback = callback;
}

/**
 * Get the current LLM call callback.
 * Used by openai-client.ts to check if tracing is active.
 */
export function getLLMCallCallback(): LLMCallCallback | null {
  return globalLLMCallCallback;
}

/**
 * Install the LLM interceptor that forwards calls to the active TickTracer.
 * Also installs the agent LLM bridge if @feed/shared provides it.
 */
export function installLLMInterceptor(): void {
  // Core engine LLM callback
  setLLMCallCallback((call: LLMCallInput) => {
    const tracer = getActiveTracer();
    if (tracer) {
      tracer.recordLLMCall(call);
    }
  });

  // Install synchronously and route through the same callback as engine calls.
  // This also lets standalone capture tools observe agent calls outside a tick.
  setAgentLLMBridge((data: AgentLLMBridgeData) => {
    const call: LLMCallInput = {
      format: 'text',
      temperature: 0,
      maxTokens: 0,
      parsedResponse: null,
      ...data,
      totalTokens: data.totalTokens ?? data.inputTokens + data.outputTokens,
    };
    getLLMCallCallback()?.(call);
  });
}

/**
 * Remove the LLM interceptor.
 */
export function uninstallLLMInterceptor(): void {
  setLLMCallCallback(null);

  setAgentLLMBridge(null);
}
