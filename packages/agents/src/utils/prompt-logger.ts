/**
 * Prompt Debug Logger for @feed/agents
 *
 * Re-exports the shared engine implementation so agents and engine write
 * identical debug logs with the same non-authoritative failure semantics.
 *
 * @packageDocumentation
 */

export {
  isPromptLoggingEnabled,
  logPrompt,
  type PromptLogEntry,
} from '@feed/engine';
