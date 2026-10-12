/**
 * Actor data completeness checks for the loaded actor roster
 * (fields the NPC posting pipeline relies on).
 */

import { describe, expect, test } from 'bun:test';
import { StaticDataRegistry } from '../../services/static-data-registry';

describe('Actor Data Completeness - FIRST Principles', () => {
  test('all actors should have id', () => {
    const actors = StaticDataRegistry.getAllActors();
    const missing = actors.filter((a) => !a.id);
    expect(missing.length).toBe(0);
  });

  test('all actors should have name', () => {
    const actors = StaticDataRegistry.getAllActors();
    const missing = actors.filter((a) => !a.name);
    expect(missing.length).toBe(0);
  });

  test('all actors should have postStyle for generating posts', () => {
    const actors = StaticDataRegistry.getAllActors();
    const missing = actors.filter((a) => !a.postStyle);

    // Log missing actors for debugging if any
    if (missing.length > 0 && process.env.DEBUG_TESTS) {
      console.debug(
        'Actors missing postStyle:',
        missing.map((a) => a.id)
      );
    }

    expect(missing.length).toBe(0);
  });

  test('all production actors should have postExample array with at least one example', () => {
    const actors = StaticDataRegistry.getAllActors();
    // Exclude test actors (they're filtered out in npc-tick anyway)
    const productionActors = actors.filter((a) => !a.isTest);
    const missing = productionActors.filter(
      (a) => !Array.isArray(a.postExample) || a.postExample.length === 0
    );

    if (missing.length > 0 && process.env.DEBUG_TESTS) {
      console.debug(
        'Actors missing postExample:',
        missing.map((a) => a.id)
      );
    }

    expect(missing.length).toBe(0);
  });

  test('all actors should have domain array', () => {
    const actors = StaticDataRegistry.getAllActors();
    const missing = actors.filter((a) => !Array.isArray(a.domain));
    expect(missing.length).toBe(0);
  });
});
