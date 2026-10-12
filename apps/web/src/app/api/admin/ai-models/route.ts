/**
 * Admin AI Models API
 *
 * @route GET /api/admin/ai-models - Get AI model configuration
 * @access Admin
 *
 * @description
 * Returns current AI provider configuration and available providers.
 *
 * @openapi
 * /api/admin/ai-models:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get AI model configuration
 *     description: Returns current AI configuration and available providers (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activeProvider:
 *                   type: string
 *                 providers:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * const config = await fetch('/api/admin/ai-models', {
 *   headers: { 'Authorization': `Bearer ${adminToken}` }
 * }).then(r => r.json());
 * ```
 */

import {
  getClientIp,
  logAdminView,
  requireAdmin,
  withErrorHandling,
} from '@feed/api';
import { FeedLLMClient } from '@feed/engine';
import { getSurplusConfig } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * GET /api/admin/ai-models
 * Returns current AI configuration and available providers
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  const admin = await requireAdmin(req);

  // Audit log the view
  await logAdminView({
    adminId: admin.userId,
    ipAddress: getClientIp(req.headers) ?? undefined,
    resourceType: 'ai_models',
    metadata: { action: 'view_config' },
  });

  // Provider availability from configured credentials
  const surplus = getSurplusConfig();
  const providers = {
    surplus: !!surplus,
    elizacloud: !!process.env.ELIZACLOUD_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
  };
  const anyConfigured = Object.values(providers).some(Boolean);

  // Active provider/model come from the same selection the game tick uses
  // (FeedLLMClient.forGameTick), not a separately maintained priority list.
  // With no credentials there is no active provider.
  const active = anyConfigured ? FeedLLMClient.forGameTick().getStats() : null;

  return NextResponse.json({
    success: true,
    data: {
      providers,
      activeProvider: active?.provider ?? null,
      activeModel: active?.model ?? null,
      recommendedModels: active
        ? [
            {
              id: active.model,
              name: `${active.model} (${active.provider})`,
              description: 'Default model for the active provider',
            },
          ]
        : [],
    },
  });
});
