/** Explicit provider deadline. Invalid configuration must not disable aborts. */
export function getAgentLLMTimeoutMs(defaultMs = 60000): number {
  const configured = process.env.AGENT_LLM_TIMEOUT_MS;
  if (configured === undefined || configured === '') return defaultMs;
  const timeout = Number(configured);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 300000) {
    throw new Error('AGENT_LLM_TIMEOUT_MS must be an integer from 1 to 300000');
  }
  return timeout;
}
