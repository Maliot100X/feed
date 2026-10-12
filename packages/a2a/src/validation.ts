/**
 * A2A Protocol Validation Schemas
 *
 * Shared parameter schemas used by the A2A executor.
 *
 * @public
 */

import { z } from 'zod';

// Pagination defaults and limits
const DEFAULT_PAGINATION_LIMIT = 10;
const MAX_PAGINATION_LIMIT = 100;

/**
 * Offset-based pagination for A2A list operations.
 * Uses offset/limit rather than page/limit like the shared PaginationSchema.
 * Uses z.coerce.number() to handle string-to-number conversion for query params.
 */
export const OffsetPaginationSchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGINATION_LIMIT)
    .default(DEFAULT_PAGINATION_LIMIT),
});

export type OffsetPaginationParams = z.infer<typeof OffsetPaginationSchema>;
