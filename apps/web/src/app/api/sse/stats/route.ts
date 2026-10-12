/**
 * SSE Stats API
 *
 * @route GET /api/sse/stats - Get SSE connection statistics
 * @access Public
 *
 * @description
 * Returns the number of Server-Sent Events (SSE) connections held by the worker
 * that serves the request (worker-local, not a global count). Per-channel counts
 * are not exposed publicly because channel names include private chat and user
 * identifiers.
 *
 * @openapi
 * /api/sse/stats:
 *   get:
 *     tags:
 *       - SSE
 *     summary: Get SSE connection statistics
 *     description: Returns statistics about connected SSE clients
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalConnections:
 *                       type: integer
 *                     scope:
 *                       type: string
 *                       enum: [worker]
 *                 timestamp:
 *                   type: integer
 *
 * @example
 * ```typescript
 * const { stats } = await fetch('/api/sse/stats')
 *   .then(r => r.json());
 * console.log(`SSE connections on this worker: ${stats.totalConnections}`);
 * ```
 *
 * @see {@link /lib/sse/event-broadcaster} Event broadcaster
 */

import {
  addPublicReadHeaders,
  connections,
  publicRateLimit,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: NextRequest) => {
  const { error, rateLimitInfo } = await publicRateLimit(request);
  if (error) return error;

  const { totalConnections } = connections.snapshot();

  const res = successResponse({
    success: true,
    stats: { totalConnections, scope: 'worker' as const },
    timestamp: Date.now(),
  });
  if (rateLimitInfo) addPublicReadHeaders(res, rateLimitInfo);
  return res;
});
