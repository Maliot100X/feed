import { describe, expect, test } from 'bun:test';
import { parseImportedTeamSelection } from './team-import';

const KNOWN = new Set(['shadow', 'viper', 'zero', 'specter']);

describe('parseImportedTeamSelection', () => {
  test('rejects non-JSON text', () => {
    const result = parseImportedTeamSelection('not json', KNOWN, 6);
    expect(result.ok).toBe(false);
  });

  test('rejects JSON without a selected string array', () => {
    expect(parseImportedTeamSelection('{"selected":[1,2]}', KNOWN, 6).ok).toBe(
      false
    );
    expect(parseImportedTeamSelection('{"foo":[]}', KNOWN, 6).ok).toBe(false);
  });

  test('drops unknown and duplicate archetype ids', () => {
    const result = parseImportedTeamSelection(
      JSON.stringify({ selected: ['shadow', 'nope', 'shadow', 'viper'] }),
      KNOWN,
      6
    );
    expect(result).toEqual({ ok: true, ids: ['shadow', 'viper'], dropped: 0 });
  });

  test('caps selections at remaining party capacity', () => {
    const result = parseImportedTeamSelection(
      JSON.stringify({ selected: ['shadow', 'viper', 'zero', 'specter'] }),
      KNOWN,
      2
    );
    expect(result).toEqual({ ok: true, ids: ['shadow', 'viper'], dropped: 2 });
  });

  test('returns no selections when the party is already full', () => {
    const result = parseImportedTeamSelection(
      JSON.stringify({ selected: ['shadow'] }),
      KNOWN,
      0
    );
    expect(result).toEqual({ ok: true, ids: [], dropped: 1 });
  });
});
