/** One OpenAI-compatible inference endpoint for Feed's server-side callers. */
export function getSurplusConfig() {
  const apiKey = process.env.SURPLUS_API_KEY;
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseURL: (
      process.env.SURPLUS_BASE_URL || 'https://api.surplusintelligence.ai/v1'
    ).replace(/\/$/, ''),
    model: process.env.SURPLUS_MODEL || 'gpt-4o-mini',
  };
}
