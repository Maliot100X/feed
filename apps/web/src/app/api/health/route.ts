import { withErrorHandling } from '@feed/api';
import { NextResponse } from 'next/server';

/**
 * Health Check API
 *
 * @description
 * Cheap process liveness check. Returns server status, timestamp, and
 * environment. It does NOT check dependencies (database, Redis, providers) or
 * the deployed revision, so it is not a readiness signal. Used by:
 * - Load balancers / uptime monitors for liveness
 * - Monitoring services (Datadog, New Relic, etc.)
 * - Uptime monitoring tools
 *
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - System
 *     summary: Health check
 *     description: Health check endpoint for monitoring service availability
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                   description: Service status
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Current ISO 8601 timestamp
 *                 env:
 *                   type: string
 *                   example: production
 *                   description: Current NODE_ENV
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/health');
 * const data = await response.json();
 * // { status: 'ok', timestamp: '2024-01-15T12:00:00.000Z', env: 'production' }
 * ```
 *
 * @see {@link https://github.com/feedforagents/feed/blob/staging/.github/workflows/ci-tests.yml} CI/CD usage
 */
export const GET = withErrorHandling(async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
    },
    { status: 200 }
  );
});
