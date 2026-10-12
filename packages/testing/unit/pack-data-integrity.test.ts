/**
 * Pack data integrity: every reference inside a pack must resolve, and every
 * lookup key must be unique (the registry's username index is last-write-wins).
 */

import { describe, expect, test } from 'bun:test';
import type { PackData } from '@feed/shared';
import * as corporatePack from '../../pack-corporate-30-under-30/src';
import * as defaultPack from '../../pack-default/src';

const packs: Array<[string, PackData]> = [
  ['pack-default', defaultPack],
  ['pack-corporate-30-under-30', corporatePack],
];

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

describe.each(packs)('%s integrity', (_name, pack) => {
  const actorIds = new Set(pack.actors.map((a) => a.id));
  const orgIds = new Set(pack.organizations.map((o) => o.id));

  test('actor and organization IDs are unique', () => {
    expect(duplicates(pack.actors.map((a) => a.id))).toEqual([]);
    expect(duplicates(pack.organizations.map((o) => o.id))).toEqual([]);
  });

  test('actor usernames are unique (case-insensitive)', () => {
    const usernames = pack.actors
      .map((a) => a.username)
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.toLowerCase());
    expect(duplicates(usernames)).toEqual([]);
  });

  test('manifest actorIds/organizationIds match pack contents', () => {
    expect([...pack.manifest.actorIds].sort()).toEqual([...actorIds].sort());
    expect([...pack.manifest.organizationIds].sort()).toEqual(
      [...orgIds].sort()
    );
  });

  test('actor affiliations reference pack organizations', () => {
    const missing = pack.actors.flatMap((a) =>
      (a.affiliations ?? [])
        .filter((orgId) => !orgIds.has(orgId))
        .map((orgId) => `${a.id} -> ${orgId}`)
    );
    expect(missing).toEqual([]);
  });

  test('rivalries reference pack actors', () => {
    const missing = (pack.manifest.rivalries ?? [])
      .flat()
      .filter((id) => !actorIds.has(id));
    expect(missing).toEqual([]);
  });

  test('org priorities reference pack organizations', () => {
    const priorities = pack.manifest.orgPriorities;
    const all = priorities
      ? [...priorities.major, ...priorities.secondary, ...priorities.media]
      : [];
    expect(all.filter((id) => !orgIds.has(id))).toEqual([]);
  });

  test('correlations reference pack organizations', () => {
    const missing = (pack.manifest.correlations ?? [])
      .flatMap((c) => [c.orgId, c.relatedOrgId])
      .filter((id) => !orgIds.has(id));
    expect(missing).toEqual([]);
  });
});
