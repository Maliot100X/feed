/**
 * StaticDataRegistry initialization: the default pack is the single source of
 * static data, clearCache() returns to it, and pack accessors initialize like
 * actor accessors.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import type { PackData } from '@feed/shared';
import { StaticDataRegistry } from '../../engine/src/services/static-data-registry';
import * as corporatePack from '../../pack-corporate-30-under-30/src';
import * as defaultPack from '../../pack-default/src';

function snapshot() {
  return {
    packId: StaticDataRegistry.getPackId(),
    actorIds: StaticDataRegistry.getActorIds(),
    orgIds: StaticDataRegistry.getOrganizationIds(),
    characterMappings: StaticDataRegistry.getAllCharacterMappings().length,
    orgMappings: StaticDataRegistry.getAllOrganizationMappings()
      .map((m) => m.realName)
      .sort(),
    correlations: StaticDataRegistry.getCorrelations().length,
  };
}

afterEach(() => {
  StaticDataRegistry.clearCache();
});

describe('StaticDataRegistry initialization (D11)', () => {
  test('pack accessors initialize on first call', () => {
    StaticDataRegistry.clearCache();
    expect(StaticDataRegistry.getPackId()).toBe(defaultPack.manifest.id);
    StaticDataRegistry.clearCache();
    expect(StaticDataRegistry.getCorrelations()).toEqual(
      defaultPack.manifest.correlations ?? []
    );
    StaticDataRegistry.clearCache();
    expect(StaticDataRegistry.getPackActor('ailon-musk')?.id).toBe(
      'ailon-musk'
    );
  });

  test('initial, cached, and post-clear states are identical', () => {
    StaticDataRegistry.clearCache();
    const initial = snapshot();
    const cached = snapshot();
    StaticDataRegistry.clearCache();
    const afterClear = snapshot();

    expect(initial.packId).toBe(defaultPack.manifest.id);
    expect(initial.actorIds).toEqual(defaultPack.actors.map((a) => a.id));
    expect(initial.orgIds).toEqual(defaultPack.organizations.map((o) => o.id));
    expect(cached).toEqual(initial);
    expect(afterClear).toEqual(initial);
  });

  test('custom pack replaces the universe; clearCache restores the default', () => {
    StaticDataRegistry.loadPack(corporatePack as PackData);
    expect(StaticDataRegistry.getPackId()).toBe(corporatePack.manifest.id);
    expect(StaticDataRegistry.getActorIds()).toEqual(
      corporatePack.actors.map((a) => a.id)
    );

    StaticDataRegistry.clearCache();
    expect(StaticDataRegistry.getPackId()).toBe(defaultPack.manifest.id);
    expect(StaticDataRegistry.getActorIds()).toEqual(
      defaultPack.actors.map((a) => a.id)
    );
  });

  test('username lookup resolves each actor to itself', () => {
    for (const actor of defaultPack.actors) {
      if (!actor.username) continue;
      expect(StaticDataRegistry.getActor(actor.username)?.id).toBe(actor.id);
    }
  });
});
