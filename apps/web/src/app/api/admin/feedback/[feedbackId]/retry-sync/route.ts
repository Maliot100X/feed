/**
 * Admin Feedback Retry Sync API
 *
 * Allows admins to manually retry Linear sync for failed feedback items.
 */

import {
  errorResponse,
  getLinearConfig,
  requireAdmin,
  successResponse,
  syncFeedbackToLinear,
  withErrorHandling,
} from '@feed/api';
import { db } from '@feed/db';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

/**
 * Linear sync fields stored in feedback metadata. Parsed strictly: a present
 * but malformed linearIssueId is treated as corrupt (not as "never synced"),
 * so a retry cannot create a duplicate issue.
 */
const LinearSyncedMetadataSchema = z.object({
  linearIssueId: z.string().min(1).optional(),
  linearIssueIdentifier: z.string().optional(),
  linearIssueUrl: z.string().optional(),
});

type LinearSyncedMetadata = z.infer<typeof LinearSyncedMetadataSchema>;

function parseLinearSyncedMetadata(
  rawMetadata: unknown
): LinearSyncedMetadata | null {
  if (rawMetadata === null || rawMetadata === undefined) return {};
  if (typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
    return null;
  }
  const parsed = LinearSyncedMetadataSchema.safeParse(rawMetadata);
  return parsed.success ? parsed.data : null;
}

interface RouteContext {
  params: Promise<{ feedbackId: string }>;
}

/**
 * POST /api/admin/feedback/[feedbackId]/retry-sync
 *
 * Manually retry Linear sync for a specific feedback item.
 */
export const POST = withErrorHandling(
  async (request: NextRequest, context: RouteContext) => {
    await requireAdmin(request);

    const { feedbackId } = await context.params;

    // Check Linear configuration
    const linearConfig = getLinearConfig();
    if (!linearConfig) {
      return errorResponse(
        'Linear integration not configured. Set LINEAR_API_KEY and LINEAR_TEAM_ID.',
        'LINEAR_NOT_CONFIGURED',
        400
      );
    }

    // Fetch feedback to verify it exists and get user info
    const feedback = await db.feedback.findUnique({
      where: { id: feedbackId },
      select: {
        id: true,
        fromUserId: true,
        metadata: true,
        interactionType: true,
      },
    });

    if (!feedback) {
      return errorResponse('Feedback not found', 'FEEDBACK_NOT_FOUND', 404);
    }

    // Only general game feedback is synced to Linear (same population as the
    // admin feedback list).
    if (feedback.interactionType !== 'general_game_feedback') {
      return errorResponse(
        'Only general game feedback can be synced to Linear',
        'NOT_GAME_FEEDBACK',
        400
      );
    }

    // Check if already synced - validate metadata at runtime
    const metadata = parseLinearSyncedMetadata(feedback.metadata);
    if (!metadata) {
      return errorResponse(
        'Feedback metadata is malformed; refusing to sync to avoid duplicate Linear issues',
        'INVALID_METADATA',
        409
      );
    }
    if (metadata.linearIssueId) {
      return successResponse({
        success: true,
        alreadySynced: true,
        linearIssue: {
          id: metadata.linearIssueId,
          identifier: metadata.linearIssueIdentifier,
          url: metadata.linearIssueUrl,
        },
        message: 'Feedback already synced to Linear',
      });
    }

    // Get user info for the sync - distinguish between orphaned feedback and deleted user
    if (!feedback.fromUserId) {
      return errorResponse(
        'Feedback has no associated user (orphaned feedback)',
        'ORPHANED_FEEDBACK',
        400
      );
    }

    const user = await db.user.findUnique({
      where: { id: feedback.fromUserId },
      select: { id: true, email: true },
    });

    if (!user) {
      return errorResponse(
        'User for feedback not found (may have been deleted)',
        'USER_NOT_FOUND',
        404
      );
    }

    // Perform sync synchronously - unlike the fire-and-forget pattern in
    // game-feedback submission, we wait for completion to return results.
    // syncFeedbackToLinear updates metadata as a side effect, so we refetch.
    await syncFeedbackToLinear(linearConfig, feedbackId, user);

    // Refetch to get canonical metadata after sync (avoids returning stale data)
    const updatedFeedback = await db.feedback.findUnique({
      where: { id: feedbackId },
      select: { metadata: true },
    });

    // Validate updated metadata at runtime
    const updatedMetadata = parseLinearSyncedMetadata(
      updatedFeedback?.metadata
    );

    if (!updatedFeedback || !updatedMetadata?.linearIssueId) {
      logger.warn('Manual Linear sync produced no issue', { feedbackId });
      return errorResponse(
        'Sync finished without a Linear issue being recorded',
        'SYNC_INCOMPLETE',
        502
      );
    }

    logger.info('Manual Linear sync completed', {
      feedbackId,
      linearIssueId: updatedMetadata.linearIssueId,
    });

    return successResponse({
      success: true,
      alreadySynced: false,
      linearIssue: {
        id: updatedMetadata.linearIssueId,
        identifier: updatedMetadata.linearIssueIdentifier,
        url: updatedMetadata.linearIssueUrl,
      },
      message: 'Successfully synced to Linear',
    });
  }
);
