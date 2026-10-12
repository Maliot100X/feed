/**
 * Game Assets API
 *
 * @route GET /api/game-assets - Get game assets
 * @access Public (optional authentication for RLS)
 *
 * @description
 * Returns game assets including group chats, actors, and other game-related
 * data needed for client-side game initialization. Designed for Cloudflare
 * Workers deployment where file system access is unavailable.
 *
 * @openapi
 * /api/game-assets:
 *   get:
 *     tags:
 *       - Game
 *     summary: Get game assets
 *     description: Returns game assets for client initialization (optional auth for RLS)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Assets retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groupChats:
 *                   type: array
 *                 actors:
 *                   type: array
 *       401:
 *         description: Unauthorized (optional)
 *
 * @example
 * ```typescript
 * const assets = await fetch('/api/game-assets').then(r => r.json());
 * const questions = await fetch('/data/questions.json').then(r => r.json());
 * ```
 *
 * @returns {object} Game assets
 * @property {boolean} success - Operation success
 * @property {object} assets - Game assets object
 * @property {array} assets.groupChats - Array of group chat objects
 *
 * **Group Chat Object:**
 * @property {string} id - Chat ID
 * @property {string} name - Chat name/title
 *
 * @throws {500} Internal server error
 *
 * @example
 * ```typescript
 * // Get game assets (public)
 * const response = await fetch('/api/game-assets');
 * const { assets } = await response.json();
 *
 * // Display group chats
 * assets.groupChats.forEach(chat => {
 *   console.log(`Chat: ${chat.name} (${chat.id})`);
 * });
 *
 * // Combine with actor data
 * const [gameAssets, actors] = await Promise.all([
 *   fetch('/api/game-assets').then(r => r.json()),
 *   fetch('/api/actors').then(r => r.json())  // Uses individual files via loader
 * ]);
 * ```
 *
 * **Authenticated Access:**
 * ```typescript
 * // With authentication
 * const response = await fetch('/api/game-assets', {
 *   headers: { 'Authorization': `Bearer ${token}` }
 * });
 * // Returns assets visible to authenticated user (RLS applied)
 * ```
 *
 * @see {@link /lib/db/context} Database context with RLS
 * @see {@link /api/actors} Actor data API endpoint
 * @see {@link /public/data/README.md} Actor data structure documentation
 * @see {@link /api/games} Games listing endpoint
 */

import { optionalAuth, successResponse, withErrorHandling } from '@feed/api';
import { asPublic, asUser } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';

type ChatReader = Parameters<Parameters<typeof asPublic>[0]>[0];

async function listGameGroupChats(db: ChatReader) {
  return db.chat.findMany({
    where: {
      isGroup: true,
      gameId: 'continuous',
    },
    select: {
      id: true,
      name: true,
    },
  });
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Optional auth: game assets are public. optionalAuth already returns null
  // for absent or invalid credentials; infrastructure errors propagate.
  const authUser = await optionalAuth(request);

  const groupChats = authUser?.userId
    ? await asUser(authUser, listGameGroupChats)
    : await asPublic(listGameGroupChats);

  // If you need additional game assets, store them in database or
  // have the client use /api/actors endpoint for actor/org/relationship data
  const assets = {
    groupChats: groupChats.map((chat) => ({
      id: chat.id,
      name: chat.name,
    })),
  };

  logger.info(
    'Game assets fetched successfully',
    { groupChatsCount: groupChats.length },
    'GET /api/game-assets'
  );

  return successResponse({
    success: true,
    assets,
  });
});
