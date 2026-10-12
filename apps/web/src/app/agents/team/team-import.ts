import { z } from 'zod';

const ImportedTeamSchema = z.object({
  selected: z.array(z.string()),
});

export type ImportedTeamSelection =
  | { ok: true; ids: string[]; dropped: number }
  | { ok: false; error: string };

/**
 * Parse team JSON produced by the roster Export button into archetype
 * selections. Unknown and duplicate IDs are discarded, and the result is
 * capped at the remaining party capacity.
 */
export function parseImportedTeamSelection(
  text: string,
  knownArchetypeIds: ReadonlySet<string>,
  remainingSlots: number
): ImportedTeamSelection {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Could not import — paste valid team JSON' };
  }
  const parsed = ImportedTeamSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid team data' };
  }
  const unique = [
    ...new Set(parsed.data.selected.filter((id) => knownArchetypeIds.has(id))),
  ];
  const capacity = Math.max(0, remainingSlots);
  const ids = unique.slice(0, capacity);
  return { ok: true, ids, dropped: unique.length - ids.length };
}
