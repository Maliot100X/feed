#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';

// Drizzle uses timestamps to decide which SQL files are pending. A later entry
// with an older timestamp is silently skipped against an existing database.
const journal = JSON.parse(
  await readFile(
    new URL(
      '../../packages/db/drizzle/migrations/meta/_journal.json',
      import.meta.url
    ),
    'utf8'
  )
) as { entries: Array<{ tag: string; when: number }> };
let latest = 0;
for (const entry of journal.entries) {
  if (!Number.isFinite(entry.when) || entry.when <= latest) {
    throw new Error(
      `Migration ${entry.tag} has a non-increasing timestamp. Reconcile the live migration baseline and backup before deploying SQL; do not rewrite applied history blindly.`
    );
  }
  latest = entry.when;
}
console.info('Migration journal timestamps are ordered');
