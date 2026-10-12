/**
 * Integration Test: PriceUpdateService uses OrganizationState as the
 * canonical previous price when computing change, even when the
 * best-effort Organization mirror row disagrees.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db, eq, organizationState, organizations } from '@feed/db';
import { PriceUpdateService } from '@feed/engine';

const ORG_ID = `test-price-org-${Date.now().toString(36)}`;

describe('PriceUpdateService canonical price source', () => {
  beforeAll(async () => {
    const now = new Date();
    await db.insert(organizationState).values({
      id: ORG_ID,
      currentPrice: 100,
      basePrice: 100,
      updatedAt: now,
    });
    await db.insert(organizations).values({
      id: ORG_ID,
      name: 'Integration test org',
      description: 'price mirror disagreement',
      type: 'company',
      currentPrice: 50,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
    await db.delete(organizationState).where(eq(organizationState.id, ORG_ID));
  });

  it('computes change from OrganizationState, not the Organization mirror', async () => {
    const [applied] = await PriceUpdateService.applyUpdates([
      { organizationId: ORG_ID, newPrice: 110, source: 'system' },
    ]);

    expect(applied?.oldPrice).toBe(100);
    expect(applied?.change).toBe(10);
    expect(applied?.changePercent).toBeCloseTo(10, 6);

    const [mirror] = await db
      .select({ currentPrice: organizations.currentPrice })
      .from(organizations)
      .where(eq(organizations.id, ORG_ID));
    expect(Number(mirror?.currentPrice)).toBe(110);
  });
});
