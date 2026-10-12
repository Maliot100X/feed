/**
 * sync-migrations script: dry-run must not create anything, and a real run
 * must record the same hashes Drizzle's migrator computes.
 *
 * Uses an isolated, uniquely named schema in the DATABASE_URL database.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { syncMigrations } from '../../db/scripts/sync-migrations';

const databaseUrl = process.env.DATABASE_URL;
const schema = `sync_test_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
const migrationsFolder = join(import.meta.dir, '../../db/drizzle/migrations');

describe.skipIf(!databaseUrl)('sync-migrations', () => {
  const sql = postgres(databaseUrl ?? '', { onnotice: () => {} });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  });

  async function schemaExists(): Promise<boolean> {
    const rows = await sql`
      SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schema}
    `;
    return rows.length > 0;
  }

  it('dry-run reports missing migrations without creating the schema', async () => {
    const result = await syncMigrations(sql, {
      dryRun: true,
      migrationsFolder,
      migrationsSchema: schema,
    });
    expect(result.inserted.length).toBeGreaterThan(0);
    expect(await schemaExists()).toBe(false);
  });

  it('records Drizzle-compatible hashes and is idempotent', async () => {
    const expected = readMigrationFiles({ migrationsFolder }).map((m) => ({
      hash: m.hash,
      createdAt: m.folderMillis,
    }));

    const first = await syncMigrations(sql, {
      dryRun: false,
      migrationsFolder,
      migrationsSchema: schema,
    });
    expect(first.inserted).toEqual(expected);

    const rows = await sql.unsafe<{ hash: string; created_at: string }[]>(
      `SELECT hash, created_at FROM "${schema}".__drizzle_migrations ORDER BY id`
    );
    expect(
      rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }))
    ).toEqual(expected);

    const second = await syncMigrations(sql, {
      dryRun: false,
      migrationsFolder,
      migrationsSchema: schema,
    });
    expect(second.inserted).toEqual([]);
    expect(second.tracked).toBe(expected.length);
  });

  it('treats legacy tag-as-hash rows as tracked by timestamp', async () => {
    const legacySchema = `${schema}_legacy`;
    try {
      await sql.unsafe(`CREATE SCHEMA "${legacySchema}"`);
      await sql.unsafe(
        `CREATE TABLE "${legacySchema}".__drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`
      );
      const [first] = readMigrationFiles({ migrationsFolder });
      await sql.unsafe(
        `INSERT INTO "${legacySchema}".__drizzle_migrations (hash, created_at) VALUES ('0000_legacy_tag', $1)`,
        [first!.folderMillis]
      );
      const result = await syncMigrations(sql, {
        dryRun: true,
        migrationsFolder,
        migrationsSchema: legacySchema,
      });
      expect(result.inserted.map((r) => r.createdAt)).not.toContain(
        first!.folderMillis
      );
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`);
    }
  });
});
