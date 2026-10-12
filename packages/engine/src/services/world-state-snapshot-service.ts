import {
  asc,
  db,
  desc,
  eq,
  generateSnowflakeId,
  organizationState,
  questionArcPlans,
  questions,
  worldEvents,
  worldStateSnapshots,
} from '@feed/db';

/**
 * Row caps per snapshot section. Each section is ordered so the cap keeps the
 * most recent rows (or a stable order for org state); rows beyond a cap are
 * not captured.
 */
export const WORLD_STATE_SNAPSHOT_LIMITS = {
  predictionMarkets: 100,
  perpMarkets: 100,
  worldEvents: 50,
  insiderAssignments: 50,
  orgStates: 100,
} as const;

export class WorldStateSnapshotService {
  /**
   * Capture a world state snapshot at the current moment.
   * Called at the end of each game tick.
   *
   * Any query failure rejects: a snapshot is never written with sections
   * silently emptied by a failed query.
   */
  static async captureSnapshot(
    windowId: string,
    packId?: string
  ): Promise<string> {
    const id = await generateSnowflakeId();
    const now = new Date();

    const [
      predictionMarkets,
      perpMarkets,
      recentWorldEvents,
      orgStates,
      insiderAssignments,
    ] = await Promise.all([
      this.getPredictionMarketState(),
      this.getPerpMarketState(),
      this.getWorldEvents(),
      this.getOrgStates(),
      this.getInsiderAssignments(),
    ]);

    await db.insert(worldStateSnapshots).values({
      id,
      windowId,
      packId: packId ?? null,
      gameDay: Math.floor(Date.now() / (24 * 60 * 60 * 1000)), // simplified
      gameTime: now,
      predictionMarketsJson: JSON.stringify(predictionMarkets),
      perpMarketsJson: JSON.stringify(perpMarkets),
      worldEventsJson: JSON.stringify(recentWorldEvents),
      insiderAssignmentsJson: JSON.stringify(insiderAssignments),
      // TODO: there is no single "current arc" source yet (arc plans are
      // per-question and captured in insiderAssignmentsJson). Leave these
      // empty rather than writing placeholder data.
      arcPhase: null,
      arcPlanJson: null,
      orgStatesJson: JSON.stringify(orgStates),
    });

    return id;
  }

  /** Most recently captured snapshot id for a window (by gameTime, then id). */
  static async getLatestSnapshot(windowId: string): Promise<string | null> {
    const result = await db
      .select({ id: worldStateSnapshots.id })
      .from(worldStateSnapshots)
      .where(eq(worldStateSnapshots.windowId, windowId))
      .orderBy(desc(worldStateSnapshots.gameTime), desc(worldStateSnapshots.id))
      .limit(1);
    return result[0]?.id ?? null;
  }

  private static async getPredictionMarketState() {
    const rows = await db
      .select({
        id: questions.id,
        text: questions.text,
        status: questions.status,
        resolvedOutcome: questions.resolvedOutcome,
      })
      .from(questions)
      .orderBy(desc(questions.createdAt), desc(questions.id))
      .limit(WORLD_STATE_SNAPSHOT_LIMITS.predictionMarkets);
    return rows.map((m) => ({
      marketId: m.id,
      question: m.text,
      status: m.status,
      resolvedOutcome: m.resolvedOutcome,
    }));
  }

  private static async getPerpMarketState() {
    const orgs = await db
      .select({
        id: organizationState.id,
        currentPrice: organizationState.currentPrice,
        basePrice: organizationState.basePrice,
      })
      .from(organizationState)
      .orderBy(asc(organizationState.id))
      .limit(WORLD_STATE_SNAPSHOT_LIMITS.perpMarkets);
    return orgs.map((o) => ({
      ticker: o.id,
      price: o.currentPrice,
      basePrice: o.basePrice,
    }));
  }

  private static async getWorldEvents() {
    return db
      .select({
        id: worldEvents.id,
        eventType: worldEvents.eventType,
        description: worldEvents.description,
      })
      .from(worldEvents)
      .orderBy(desc(worldEvents.timestamp), desc(worldEvents.id))
      .limit(WORLD_STATE_SNAPSHOT_LIMITS.worldEvents);
  }

  private static async getInsiderAssignments() {
    return db
      .select({
        id: questionArcPlans.id,
        questionId: questionArcPlans.questionId,
        insiderActorIds: questionArcPlans.insiderActorIds,
        deceiverActorIds: questionArcPlans.deceiverActorIds,
      })
      .from(questionArcPlans)
      .orderBy(desc(questionArcPlans.createdAt), desc(questionArcPlans.id))
      .limit(WORLD_STATE_SNAPSHOT_LIMITS.insiderAssignments);
  }

  private static async getOrgStates() {
    return db
      .select()
      .from(organizationState)
      .orderBy(asc(organizationState.id))
      .limit(WORLD_STATE_SNAPSHOT_LIMITS.orgStates);
  }
}
