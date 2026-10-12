import { describe, expect, it } from 'bun:test';
import {
  buildCanonicalSimulationRoster,
  buildLocalCharacterRoster,
  CANONICAL_SIMULATION_CHARACTER_IDS,
} from '../local-roster';

describe('local character roster', () => {
  it('builds independent sheets that do not share mutable seed state', () => {
    const first = buildLocalCharacterRoster();
    const sheet = first[0]!;
    sheet.topics.push('mutated-topic');
    sheet.feed.motivations.push('mutated-motivation');
    sheet.feed.fears.push('mutated-fear');
    sheet.feed.autonomy.trading = false;
    sheet.settings.groq.primary = 'mutated-model';

    const second = buildLocalCharacterRoster()[0]!;
    expect(second.topics).not.toContain('mutated-topic');
    expect(second.feed.motivations).not.toContain('mutated-motivation');
    expect(second.feed.fears).not.toContain('mutated-fear');
    expect(second.feed.autonomy.trading).toBe(true);
    expect(second.settings.groq.primary).not.toBe('mutated-model');
  });

  it('canonical roster matches the declared id list', () => {
    const roster = buildCanonicalSimulationRoster();
    expect(roster.map((s) => s.id)).toEqual([
      ...CANONICAL_SIMULATION_CHARACTER_IDS,
    ]);
    expect(new Set(roster.map((s) => s.id)).size).toBe(roster.length);
  });
});
