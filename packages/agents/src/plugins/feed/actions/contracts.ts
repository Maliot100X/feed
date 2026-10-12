import type { HandlerCallback, IAgentRuntime } from '@elizaos/core';
import type { JsonValue } from '../../../types/common';
import type { FeedRuntime } from '../types';

export function clientFor(runtime: IAgentRuntime) {
  const client = (runtime as FeedRuntime).a2aClient;
  if (!client?.isConnected())
    throw new Error('A2A action requires an active connection');
  return client;
}
export async function complete(
  name: string,
  raw: JsonValue,
  callback?: HandlerCallback
) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    raw.success !== true
  ) {
    const detail =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw.message ?? raw.error)
        : undefined;
    throw new Error(
      `${name} failed: ${typeof detail === 'string' ? detail : 'missing explicit successful outcome'}`
    );
  }
  const text = `${name} completed: ${JSON.stringify(raw)}`;
  if (callback) await callback({ text, actions: [name], data: raw });
  return { success: true, text, data: raw };
}
