import { afterAll, describe, expect, test } from 'bun:test';
import {
  db,
  eq,
  inArray,
  perpPositions,
  positions,
  worldEvents,
} from '@feed/db';
import {
  getAgentPositions,
  getMoodState,
  getWorldEventsContext,
} from '../../agents/src/autonomous/utils/context-gatherers';

const marker = `context-audit-${crypto.randomUUID()}`;
const eventIds = [`${marker}-public`, `${marker}-private`];

afterAll(async () => {
  await db.delete(perpPositions).where(eq(perpPositions.userId, marker));
  await db.delete(positions).where(eq(positions.userId, marker));
  await db.delete(worldEvents).where(inArray(worldEvents.id, eventIds));
});

describe('Agent required context against real persistence', () => {
  test('includes every open position and excludes closed exposure', async () => {
    await db.insert(perpPositions).values(
      Array.from({ length: 13 }, (_, i) => ({
        id: `${marker}-perp-${i}`,
        userId: marker,
        ticker: `AUDIT${i}`,
        organizationId: marker,
        side: 'long',
        entryPrice: 10,
        currentPrice: 12,
        size: 100,
        leverage: 1,
        liquidationPrice: 0,
        unrealizedPnL: 20,
        unrealizedPnLPercent: 20,
        lastUpdated: new Date(),
        closedAt: i === 12 ? new Date() : null,
      }))
    );
    const result = await getAgentPositions(marker);
    expect(result.perps).toHaveLength(12);
    expect(result.perps.map((p) => p.ticker)).toContain('AUDIT11');
    expect(result.perps.map((p) => p.ticker)).not.toContain('AUDIT12');
    await db
      .update(perpPositions)
      .set({ currentPrice: 0 })
      .where(eq(perpPositions.id, `${marker}-perp-0`));
    await expect(getAgentPositions(marker)).rejects.toThrow('currentPrice');
    await db
      .update(perpPositions)
      .set({ currentPrice: 12 })
      .where(eq(perpPositions.id, `${marker}-perp-0`));
  });

  test('rejects missing market reference rather than inventing a mark', async () => {
    await db.insert(positions).values({
      id: `${marker}-prediction`,
      userId: marker,
      marketId: `${marker}-missing`,
      side: true,
      shares: '10',
      avgPrice: '0.5',
      updatedAt: new Date(),
    });
    await expect(getAgentPositions(marker)).rejects.toThrow('Missing market');
  });

  test('rejects absent NPC state', async () => {
    await expect(getMoodState(marker)).rejects.toThrow('Missing actorState');
  });

  test('user context excludes private events and outcome associations', async () => {
    await db.insert(worldEvents).values(
      eventIds.map((id, i) => ({
        id,
        eventType: 'announcement',
        description: id,
        actors: [marker],
        visibility: i === 0 ? 'public' : 'private',
        relatedQuestion: 9191,
        pointsToward: 'YES',
        timestamp: new Date(),
      }))
    );
    const publicContext = await getWorldEventsContext(marker, false);
    const event = publicContext.find((e) => e.description === eventIds[0]);
    expect(event).toBeDefined();
    expect(event?.relatedQuestion).toBeUndefined();
    expect(event?.pointsToward).toBeUndefined();
    expect(publicContext.some((e) => e.description === eventIds[1])).toBe(
      false
    );
    const npcContext = await getWorldEventsContext(marker, true);
    expect(
      npcContext.find((e) => e.description === eventIds[1])?.relatedQuestion
    ).toBe(9191);
  });
});
