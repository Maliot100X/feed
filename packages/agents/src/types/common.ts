/**
 * Common Type Definitions for @feed/agents
 *
 * Generic contracts are canonical in @feed/shared and re-exported here for
 * backwards-compatible agents import paths. Only agent-specific types are
 * defined locally.
 */

import type { JsonValue } from '@feed/shared';

export {
  type ApiResponse,
  type ErrorLike,
  type FilterParams,
  type JsonRpcParams,
  type JsonRpcResult,
  type JsonValue,
  JsonValueSchema,
  type LogData,
  type PaginatedResponse,
  type PaginationParams,
  type QueryParams,
  type SortOrder,
  type SortParams,
  type StringRecord,
} from '@feed/shared';

/**
 * LLM response wrapper
 */
export interface LLMResponse<T = JsonValue> {
  content: string;
  parsed?: T;
  raw?: string;
  metadata?: {
    model?: string;
    tokens?: number;
    temperature?: number;
  };
}
