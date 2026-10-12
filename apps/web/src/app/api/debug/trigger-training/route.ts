/**
 * Debug Training Trigger API
 *
 * @route POST /api/debug/trigger-training - Trigger training manually
 * @access Admin only
 *
 * @description
 * Manually dispatches the GitHub Actions training workflow
 * (`repository_dispatch` event `trigger-training`, handled by
 * .github/workflows/rl-training.yml). Always requires admin authentication.
 * A successful response means the dispatch was accepted by GitHub, not that
 * a training run has started or completed.
 *
 * @openapi
 * /api/debug/trigger-training:
 *   post:
 *     tags:
 *       - Debug
 *     summary: Trigger training manually
 *     description: Dispatches the training workflow (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 description: Skip readiness check
 *               windowId:
 *                 type: string
 *                 description: Specific training window
 *               batchId:
 *                 type: string
 *                 description: Batch identifier (generated when omitted)
 *     responses:
 *       200:
 *         description: Training workflow dispatch accepted
 *       400:
 *         description: Invalid body or training not ready
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *
 * @example
 * ```typescript
 * await fetch('/api/debug/trigger-training', {
 *   method: 'POST',
 *   headers: {
 *     Authorization: `Bearer ${adminToken}`,
 *     'Content-Type': 'application/json',
 *   },
 *   body: JSON.stringify({ force: true }),
 * });
 * ```
 */

import { requireAdmin, withErrorHandling } from '@feed/api';
import { logger } from '@feed/shared';
import { automationPipeline } from '@feed/training';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const TriggerTrainingSchema = z
  .object({
    force: z.boolean().default(false),
    windowId: z.string().min(1).max(128).optional(),
    batchId: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,128}$/)
      .optional(),
  })
  .strict();

const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Security: ALWAYS require ADMIN authentication
  // This endpoint triggers expensive GitHub Actions workflows
  await requireAdmin(request);

  const rawBody = await request.text();
  let body: unknown = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }
  }
  const parsed = TriggerTrainingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }
  const { force, windowId = null } = parsed.data;
  const batchId = parsed.data.batchId ?? `debug-batch-${crypto.randomUUID()}`;

  logger.info(
    'Debug: Manual training trigger',
    { force, windowId, batchId },
    'DebugTrainingTrigger'
  );

  // 1. Check readiness (unless forced)
  if (!force) {
    const readiness = await automationPipeline.checkTrainingReadiness();

    if (!readiness.ready) {
      return NextResponse.json(
        {
          success: false,
          triggered: false,
          reason: readiness.reason,
          stats: readiness.stats,
          suggestion: 'Send { "force": true } to skip the readiness check',
        },
        { status: 400 }
      );
    }
  }

  // 2. Get GitHub credentials
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO; // format: "owner/repo"

  if (!githubToken || !githubRepo || !GITHUB_REPO_PATTERN.test(githubRepo)) {
    return NextResponse.json(
      {
        success: false,
        error: 'GitHub Actions not configured',
        required: {
          GITHUB_TOKEN: !!githubToken,
          GITHUB_REPO: !!githubRepo && GITHUB_REPO_PATTERN.test(githubRepo),
        },
        help: 'Set GITHUB_TOKEN and GITHUB_REPO ("owner/repo") environment variables',
      },
      { status: 500 }
    );
  }

  // 3. Trigger GitHub Actions workflow
  logger.info(
    'Dispatching GitHub Actions workflow',
    { repo: githubRepo, force, windowId, batchId },
    'DebugTrainingTrigger'
  );

  const dispatchResponse = await fetch(
    `https://api.github.com/repos/${githubRepo}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Feed-Training-Trigger',
      },
      body: JSON.stringify({
        event_type: 'trigger-training',
        client_payload: {
          batch_id: batchId,
          window_id: windowId,
          force,
          source: 'debug_endpoint',
          triggered_at: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!dispatchResponse.ok) {
    // Upstream error bodies are neither logged nor returned.
    logger.error(
      'GitHub Actions dispatch failed',
      { status: dispatchResponse.status },
      'DebugTrainingTrigger'
    );

    return NextResponse.json(
      {
        success: false,
        error: `GitHub API returned ${dispatchResponse.status}`,
        help: 'Verify GITHUB_TOKEN has workflow permissions',
      },
      { status: 502 }
    );
  }

  logger.info(
    'GitHub Actions workflow dispatch accepted',
    { batchId, windowId, force },
    'DebugTrainingTrigger'
  );

  // GitHub dispatches return 204 No Content on acceptance; the run itself
  // is tracked in GitHub Actions.
  return NextResponse.json({
    success: true,
    triggered: true,
    method: 'github_actions_dispatch',
    batchId,
    windowId,
    force,
    message:
      'Training workflow dispatch accepted. Check GitHub Actions to monitor progress.',
    links: {
      githubActions: `https://github.com/${githubRepo}/actions/workflows/rl-training.yml`,
    },
  });
});
