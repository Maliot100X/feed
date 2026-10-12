/**
 * Common Type Definitions
 *
 * Shared types for common patterns that replace 'unknown' and 'any'
 */

import type { JsonValue } from '@feed/shared';

// Generic contracts are canonical in @feed/shared; re-exported here for
// backwards-compatible engine import paths.
export type {
  ApiResponse,
  ErrorLike,
  FilterParams,
  JsonRpcParams,
  JsonRpcResult,
  JsonValue,
  LogData,
  PaginatedResponse,
  PaginationParams,
  QueryParams,
  SortOrder,
  SortParams,
  StringRecord,
} from '@feed/shared';

/**
 * WebSocket message data payload
 */
export interface WebSocketData {
  type: string;
  payload?: JsonValue;
  timestamp?: string;
  [key: string]: JsonValue | undefined;
}

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
