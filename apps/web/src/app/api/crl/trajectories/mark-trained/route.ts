/**
 * Mark Trajectories as Trained
 *
 * @route POST /api/crl/trajectories/mark-trained
 * @access Service (CRON_SECRET bearer token)
 *
 * Called by the Nebius CRL trainer after processing a batch of trajectories.
 * Marks them as usedInTraining=true so they won't be re-fetched.
 *
 * Body: { trajectoryIds: string[], batchId?: string }
 */

import { withCronAuth, withErrorHandling } from '@feed/api';
import { and, db, eq, inArray, trajectories } from '@feed/db';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const MarkTrainedSchema = z.object({
  trajectoryIds: z.array(z.string().min(1).max(256)).min(1).max(500),
  batchId: z.string().max(256).optional(),
});

export const POST = withErrorHandling(
  withCronAuth('CrlMarkTrained', async (request: NextRequest) => {
    const parsed = MarkTrainedSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            'trajectoryIds must be a non-empty array of at most 500 trajectory IDs',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const trajectoryIds = [...new Set(parsed.data.trajectoryIds)];
    const batchId = parsed.data.batchId || null;

    // Only flip rows that have not been consumed yet so a different run
    // cannot overwrite an existing trainedInBatch attribution.
    const updated = await db
      .update(trajectories)
      .set({
        usedInTraining: true,
        updatedAt: new Date(),
        ...(batchId ? { trainedInBatch: batchId } : {}),
      })
      .where(
        and(
          inArray(trajectories.trajectoryId, trajectoryIds),
          eq(trajectories.usedInTraining, false)
        )
      )
      .returning({ trajectoryId: trajectories.trajectoryId });

    return NextResponse.json(
      {
        success: true,
        requested: trajectoryIds.length,
        marked: updated.length,
        batchId,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  })
);
