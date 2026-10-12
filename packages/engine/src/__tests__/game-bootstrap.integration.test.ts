/**
 * Integration tests for GameBootstrapService NPC user provisioning.
 *
 * Safety: this suite never deletes or mutates pre-existing rows. It only
 * removes the NPC User rows it observed being created during the test.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { db, inArray, users } from '@feed/db';

describe('NPC User Provisioning', () => {
  // Only rows this test created (absent before ensureNpcUsers ran)
  const createdNpcUserIds: string[] = [];

  afterEach(async () => {
    if (createdNpcUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdNpcUserIds));
      createdNpcUserIds.length = 0;
    }
  });

  it('ensures every NPC actor has a User record and is idempotent', async () => {
    const { GameBootstrapService } = await import(
      '../services/game-bootstrap-service'
    );

    const staticActors = GameBootstrapService.getStaticActors();
    expect(staticActors.length).toBeGreaterThan(0);
    const npcUserIds = staticActors.map((a) => a.id);

    const before = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, npcUserIds));
    const preExisting = new Set(before.map((u) => u.id));
    const missingBefore = npcUserIds.filter((id) => !preExisting.has(id));

    const createdCount =
      await GameBootstrapService['ensureNpcUsers'](staticActors);
    createdNpcUserIds.push(...missingBefore);

    const after = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, npcUserIds));

    expect(after.length).toBe(staticActors.length);
    expect(createdCount).toBe(missingBefore.length);

    const secondRunCount =
      await GameBootstrapService['ensureNpcUsers'](staticActors);
    expect(secondRunCount).toBe(0);
  });

  it('should handle empty actors array gracefully', async () => {
    const { GameBootstrapService } = await import(
      '../services/game-bootstrap-service'
    );

    const result = await GameBootstrapService['ensureNpcUsers']([]);
    expect(result).toBe(0);
  });
});
