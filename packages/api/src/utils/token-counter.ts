/**
 * Token Counter Utility
 *
 * @description Provides accurate token counting for different LLM models.
 * Uses tiktoken for OpenAI-compatible models and character-based approximations
 * for others. Includes utilities for truncating text to token limits and
 * model-specific token limit definitions.
 */

// tiktoken is a peer dependency - import types only
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Tiktoken } from 'tiktoken';

// Lazy-load encoding to avoid startup overhead. The promise is cached so
// concurrent first calls share one WASM encoder.
let encodingPromise: Promise<Tiktoken> | null = null;

/**
 * Get the tiktoken encoding (lazy-loaded)
 *
 * @description Lazy-loads the tiktoken encoding to avoid startup overhead.
 * Uses GPT-4 encoding which works for most OpenAI-compatible models.
 *
 * @returns {Promise<Tiktoken>} Tiktoken encoding instance
 * @private
 */
function getEncoding(): Promise<Tiktoken> {
  if (!encodingPromise) {
    const pending = import('tiktoken').then((tiktoken) =>
      // gpt-4 encoding: gpt-5.x is not a standard tiktoken model
      tiktoken.encoding_for_model('gpt-4')
    );
    encodingPromise = pending;
    pending.catch(() => {
      if (encodingPromise === pending) encodingPromise = null;
    });
  }
  return encodingPromise;
}

function assertTokenBudget(maxTokens: number): void {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 0) {
    throw new Error(`Invalid token budget: ${maxTokens}`);
  }
}

/**
 * Count tokens in text
 *
 * @description Counts tokens in text using tiktoken for accurate counting.
 * Falls back to character-based approximation if tiktoken is unavailable.
 *
 * @param {string} text - Text to count tokens for
 * @returns {Promise<number>} Number of tokens
 *
 * @example
 * ```typescript
 * const tokens = await countTokens('Hello, world!');
 * // Returns: ~3 tokens
 * ```
 */
export async function countTokens(text: string): Promise<number> {
  const enc = await getEncoding();
  const tokens = enc.encode(text);
  return tokens.length;
}

/**
 * Count tokens in text (synchronous approximation)
 *
 * @description Provides a quick token count estimate using character-based
 * approximation (1 token per 4 characters). Use when async overhead is
 * not acceptable. Less accurate than countTokens but faster.
 *
 * @param {string} text - Text to count tokens for
 * @returns {number} Approximate number of tokens
 *
 * @example
 * ```typescript
 * const tokens = countTokensSync('Hello, world!');
 * // Returns: ~4 tokens (approximation)
 * ```
 */
export function countTokensSync(text: string): number {
  // Approximation: 1 token per 4 characters (conservative)
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token limit
 *
 * @description Truncates text to fit within a token limit using binary search
 * for optimal truncation. Can preserve the beginning or end of text.
 *
 * @param {string} text - Text to truncate
 * @param {number} maxTokens - Maximum token limit
 * @param {object} [options] - Truncation options
 * @param {boolean} [options.ellipsis=true] - Add ellipsis to truncated text
 * @param {boolean} [options.preserveEnd=false] - Preserve end instead of beginning
 * @returns {Promise<{text: string, tokens: number}>} Truncated text and token count
 *
 * @example
 * ```typescript
 * const result = await truncateToTokenLimit(longText, 1000);
 * // Returns: { text: 'truncated...', tokens: 1000 }
 * ```
 */
export async function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  options: {
    ellipsis?: boolean;
    preserveEnd?: boolean;
  } = {}
): Promise<{ text: string; tokens: number }> {
  const { preserveEnd = false } = options;
  assertTokenBudget(maxTokens);

  const currentTokens = await countTokens(text);

  if (currentTokens <= maxTokens) {
    return { text, tokens: currentTokens };
  }

  // The ellipsis is only added when its tokens fit in the budget.
  let ellipsisText = options.ellipsis === false ? '' : '...';
  let ellipsisTokens = ellipsisText ? await countTokens(ellipsisText) : 0;
  if (ellipsisTokens > maxTokens) {
    ellipsisText = '';
    ellipsisTokens = 0;
  }
  const targetTokens = maxTokens - ellipsisTokens;

  let low = 0;
  let high = text.length;
  let bestLength = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const slice = preserveEnd
      ? text.slice(text.length - mid)
      : text.slice(0, mid);
    const tokens = await countTokens(slice);

    if (tokens <= targetTokens) {
      bestLength = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const truncated = preserveEnd
    ? ellipsisText + text.slice(text.length - bestLength)
    : text.slice(0, bestLength) + ellipsisText;

  const finalTokens = await countTokens(truncated);

  return { text: truncated, tokens: finalTokens };
}

/**
 * Truncate text to fit within token limit (synchronous approximation)
 *
 * @description Truncates text using character-based approximation. Faster
 * than truncateToTokenLimit but less accurate.
 *
 * @param {string} text - Text to truncate
 * @param {number} maxTokens - Maximum token limit
 * @param {object} [options] - Truncation options
 * @param {boolean} [options.ellipsis=true] - Add ellipsis to truncated text
 * @param {boolean} [options.preserveEnd=false] - Preserve end instead of beginning
 * @returns {{text: string, tokens: number}} Truncated text and approximate token count
 */
export function truncateToTokenLimitSync(
  text: string,
  maxTokens: number,
  options: {
    ellipsis?: boolean;
    preserveEnd?: boolean;
  } = {}
): { text: string; tokens: number } {
  const { preserveEnd = false } = options;
  assertTokenBudget(maxTokens);

  const currentTokens = countTokensSync(text);

  if (currentTokens <= maxTokens) {
    return { text, tokens: currentTokens };
  }

  let ellipsisText = options.ellipsis === false ? '' : '...';
  let ellipsisTokens = ellipsisText ? countTokensSync(ellipsisText) : 0;
  if (ellipsisTokens > maxTokens) {
    ellipsisText = '';
    ellipsisTokens = 0;
  }
  const targetTokens = maxTokens - ellipsisTokens;

  // Approximate character length based on token limit (4 chars per token)
  const targetChars = targetTokens * 4;

  // slice(text.length - 0) would return the whole string, so handle 0.
  const kept =
    targetChars === 0
      ? ''
      : preserveEnd
        ? text.slice(text.length - targetChars)
        : text.slice(0, targetChars);
  const truncated = preserveEnd ? ellipsisText + kept : kept + ellipsisText;

  const finalTokens = countTokensSync(truncated);

  return { text: truncated, tokens: finalTokens };
}

/**
 * Model-specific INPUT CONTEXT token limits
 *
 * @description Defines input context token limits for various LLM models.
 * Context windows include both input and generated output tokens.
 * See individual model comments for output limits.
 */
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  // OpenAGI (input context)
  'qwen3-32b': 32768,
  'gpt-6-luna': 1050000,
  'gpt-5.1': 128000, // 128k input, separate output limit
  'gpt-5-nano': 128000, // 128k input, separate output limit
  'gpt-5.1-turbo': 128000,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,

  // Current Strategy Models - INPUT CONTEXT LIMITS (output is separate!)
  // Unsloth Qwen3 models - all have 128K context (critical requirement)
  'unsloth/Qwen3-4B-128K': 131072, // 4B params, 128K context (8GB VRAM min) - DEFAULT
  'unsloth/Qwen3-8B-128K': 131072, // 8B params, 128K context (16GB VRAM min)
  'unsloth/Qwen3-14B-128K': 131072, // 14B params, 128K context (24GB VRAM min)
  'unsloth/Qwen3-32B-128K': 131072, // 32B params, 128K context (48GB VRAM min)
  'OpenPipe/Qwen3-14B-Instruct': 32768, // 32,768 native INPUT via W&B API
  'Qwen/Qwen2.5-32B-Instruct': 131072, // 131k INPUT, 40,960 OUTPUT (separate)

  // Groq Models - INPUT CONTEXT (per https://console.groq.com/docs/models)
  // Production Models
  'llama-3.1-8b-instant': 131072, // 131k INPUT, 131k OUTPUT (unique - same!)
  'llama-3.3-70b-versatile': 131072, // 131k INPUT, 32,768 OUTPUT
  'llama-3.1-70b-versatile': 131072, // 131k INPUT, 32,768 OUTPUT
  'meta-llama/llama-guard-4-12b': 131072, // 131k INPUT, 1,024 OUTPUT
  'openai/gpt-oss-120b': 131072, // 131k INPUT, 65,536 OUTPUT
  'openai/gpt-oss-20b': 131072, // 131k INPUT, 65,536 OUTPUT
  'whisper-large-v3': 0, // Audio model (no text context)
  'whisper-large-v3-turbo': 0, // Audio model (no text context)
  // Preview Models
  'meta-llama/llama-4-maverick-17b-128e-instruct': 131072, // 131k INPUT, 8,192 OUTPUT
  'meta-llama/llama-4-scout-17b-16e-instruct': 131072, // 131k INPUT, 8,192 OUTPUT
  'moonshotai/kimi-k2-instruct': 262144, // 262k INPUT, 16,384 OUTPUT
  'moonshotai/kimi-k2-instruct-0905': 262144, // 262k INPUT, 16,384 OUTPUT (versioned)
  'openai/gpt-oss-safeguard-20b': 131072, // 131k INPUT, 65,536 OUTPUT
  // Legacy
  'mixtral-8x7b-32768': 32768,

  // Anthropic - Claude 4.5 series (200K context)
  'claude-sonnet-4-5': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4-5': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-opus-4-1': 200000,
  'claude-opus-4-1-20250805': 200000,
};

/**
 * Get maximum token limit for a model
 *
 * @description Returns the configured input token limit for a model, or a
 * conservative default (8192) if the model is unknown.
 *
 * @param {string} model - Model identifier
 * @returns {number} Maximum input token limit
 *
 * @example
 * ```typescript
 * const limit = getModelTokenLimit('gpt-5.1');
 * // Returns: 128000
 * ```
 */
export function getModelTokenLimit(model: string): number {
  // Unknown models get a conservative default; a configured 0 (non-text
  // models) is returned as 0.
  return MODEL_TOKEN_LIMITS[model] ?? 8192;
}

/**
 * Calculate safe context limit with safety margin
 *
 * @description Calculates a safe input context limit by applying a safety margin
 * to the model's maximum token limit. Note: Input and output are SEPARATE limits
 * on modern models, so the safety margin is minimal (2% default).
 *
 * @param {string} model - Model name
 * @param {number} [_outputTokens=8000] - Expected output tokens (unused, kept for compatibility)
 * @param {number} [safetyMargin=0.02] - Safety margin to reserve (default: 2%)
 * @returns {number} Safe input context limit (minimum 1000 tokens)
 *
 * @example
 * ```typescript
 * const safeLimit = getSafeContextLimit('gpt-5.1', 8000, 0.05);
 * // Returns: ~121600 (128000 * 0.95)
 * ```
 */
export function getSafeContextLimit(
  model: string,
  outputTokens = 8000,
  safetyMargin = 0.02
): number {
  const contextLimit = getModelTokenLimit(model);
  if (
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0 ||
    !Number.isFinite(safetyMargin) ||
    safetyMargin < 0 ||
    safetyMargin >= 1
  ) {
    throw new Error('Invalid model token budget');
  }
  const available =
    Math.floor(contextLimit * (1 - safetyMargin)) - outputTokens;
  if (available <= 0)
    throw new Error(
      `No input context remains for ${model} after reserving ${outputTokens} output tokens`
    );
  return available;
}

/**
 * Budget tokens across multiple sections
 *
 * @description Allocates tokens across multiple sections based on priority.
 * First allocates minimum tokens to each section, then distributes remaining
 * tokens proportionally by priority.
 *
 * @param {number} totalTokens - Total tokens available
 * @param {Array<{name: string, priority: number, minTokens?: number}>} sections - Sections to budget
 * @returns {Record<string, number>} Token allocation per section
 *
 * @example
 * ```typescript
 * const budget = budgetTokens(10000, [
 *   { name: 'system', priority: 1, minTokens: 1000 },
 *   { name: 'user', priority: 3, minTokens: 500 },
 *   { name: 'context', priority: 2 }
 * ]);
 * // Returns: { system: 2000, user: 6000, context: 2000 }
 * ```
 */
export function budgetTokens(
  totalTokens: number,
  sections: Array<{ name: string; priority: number; minTokens?: number }>
): Record<string, number> {
  assertTokenBudget(totalTokens);
  const budget: Record<string, number> = {};

  // First, allocate minimum tokens to each section
  let remaining = totalTokens;
  for (const section of sections) {
    const min = section.minTokens || 0;
    remaining -= min;
    budget[section.name] = min;
  }

  // If we're already over budget, scale down proportionally
  if (remaining < 0) {
    const scale = totalTokens / (totalTokens - remaining);
    for (const section of sections) {
      budget[section.name] = Math.floor((section.minTokens || 0) * scale);
    }
    return budget;
  }

  // Distribute remaining tokens by priority (nothing extra when no section
  // has a positive priority).
  const totalPriority = sections.reduce((sum, s) => sum + s.priority, 0);
  if (totalPriority <= 0) {
    return budget;
  }

  for (const section of sections) {
    const share = (section.priority / totalPriority) * remaining;
    budget[section.name] = (budget[section.name] || 0) + Math.floor(share);
  }

  return budget;
}
