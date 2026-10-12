/**
 * Organizations API
 *
 * @route GET /api/organizations - Get organizations
 * @access Public
 *
 * @description
 * Returns list of organizations in the game world. Supports filtering by IDs
 * for batch lookups. Organizations represent groups, factions, and institutions
 * in the Feed game world.
 *
 * @openapi
 * /api/organizations:
 *   get:
 *     tags:
 *       - Organizations
 *     summary: Get organizations
 *     description: Returns list of organizations, optionally filtered by IDs
 *     parameters:
 *       - in: query
 *         name: ids
 *         schema:
 *           type: string
 *         description: Comma-separated organization IDs for batch lookup (max 100)
 *         example: org1,org2,org3
 *     responses:
 *       200:
 *         description: Organizations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 organizations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       description:
 *                         type: string
 *                 total:
 *                   type: integer
 *                 hasMore:
 *                   type: boolean
 *                   description: True when the unfiltered listing was capped at 100
 *
 * @example
 * ```typescript
 * // List organizations (capped at 100; see hasMore)
 * const response = await fetch('/api/organizations');
 * const { organizations } = await response.json();
 *
 * // Get specific organizations
 * const batch = await fetch('/api/organizations?ids=org1,org2');
 * ```
 *
 * Reads the static data registry (no database/RLS involved).
 */

import {
  addPublicReadHeaders,
  publicRateLimit,
  withErrorHandling,
} from '@feed/api';
import { StaticDataRegistry } from '@feed/engine';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const MAX_ORGANIZATIONS = 100;

/**
 * GET /api/organizations
 *
 * @description Get organizations, optionally filtered by IDs
 *
 * @param {NextRequest} request - Request object
 *
 * @returns {Promise<NextResponse>} Organizations data
 */
export const GET = withErrorHandling(async function GET(request: NextRequest) {
  const { error, rateLimitInfo } = await publicRateLimit(request);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get('ids');

  const allOrgs = StaticDataRegistry.getAllOrganizations();

  // Parse ids once into a bounded, trimmed, de-duplicated set.
  const requestedIds = idsParam
    ? new Set(
        idsParam
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      )
    : null;
  if (requestedIds && requestedIds.size > MAX_ORGANIZATIONS) {
    return NextResponse.json(
      {
        success: false,
        error: `At most ${MAX_ORGANIZATIONS} ids may be requested`,
      },
      { status: 400 }
    );
  }

  const selected = requestedIds
    ? allOrgs.filter((org) => requestedIds.has(org.id))
    : allOrgs.slice(0, MAX_ORGANIZATIONS);

  const organizations = selected.map((org) => ({
    id: org.id,
    name: org.name,
    type: org.type,
    description: org.description ?? null,
  }));

  const res = NextResponse.json({
    success: true,
    organizations,
    // Unfiltered listings are capped; report whether the catalog was truncated.
    total: requestedIds ? organizations.length : allOrgs.length,
    hasMore: !requestedIds && allOrgs.length > MAX_ORGANIZATIONS,
  });
  if (rateLimitInfo) addPublicReadHeaders(res, rateLimitInfo);
  return res;
});
