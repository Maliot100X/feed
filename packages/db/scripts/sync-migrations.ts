/**
 * Sync migrations script to populate the __drizzle_migrations table.
 *
 * Needed when the database schema was applied via db:push or manual SQL but
 * the migrations tracking table wasn't updated. Records every journal entry as
 * applied, using the same hash Drizzle's migrator computes (SHA-256 of the
 * migration SQL) and the journal timestamp as created_at.
 *
 * Usage: DATABASE_URL="..." bun run packages/db/scripts/sync-migrations.ts
 *
 * Options:
 *   --dry-run    Report what would be inserted without creating or writing anything
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_FOLDER = join(__dirname, '../drizzle/migrations');

export interface SyncMigrationsOptions {
  dryRun: boolean;
  migrationsFolder?: string;
  /** Schema holding __drizzle_migrations (Drizzle default: "drizzle"). */
  migrationsSchema?: string;
}

export interface SyncMigrationsResult {
  tracked: number;
  inserted: Array<{ hash: string; createdAt: number }>;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Insert missing migration records. A journal entry counts as tracked when a
 * row has its hash OR its timestamp (older versions of this script wrote the
 * tag instead of the hash, and Drizzle's migrator decides by created_at).
 *
 * In dry-run mode nothing is created or written.
 */
export async function syncMigrations(
  sql: postgres.Sql,
  options: SyncMigrationsOptions
): Promise<SyncMigrationsResult> {
  const migrations = readMigrationFiles({
    migrationsFolder: options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER,
  });
  const schema = options.migrationsSchema ?? 'drizzle';
  const table = `${quoteIdent(schema)}.${quoteIdent('__drizzle_migrations')}`;

  const [{ exists } = { exists: false }] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass(${`${quoteIdent(schema)}.__drizzle_migrations`}) IS NOT NULL AS exists
  `;

  const existingRows = exists
    ? await sql<{ hash: string; created_at: string }[]>`
        SELECT hash, created_at FROM ${sql.unsafe(table)}
      `
    : [];
  const existingHashes = new Set(existingRows.map((row) => row.hash));
  const existingTimestamps = new Set(
    existingRows.map((row) => Number(row.created_at))
  );

  const missing = migrations.filter(
    (migration) =>
      !existingHashes.has(migration.hash) &&
      !existingTimestamps.has(migration.folderMillis)
  );
  const inserted = missing.map((migration) => ({
    hash: migration.hash,
    createdAt: migration.folderMillis,
  }));

  if (options.dryRun || inserted.length === 0) {
    return { tracked: migrations.length - missing.length, inserted };
  }

  await sql.begin(async (tx) => {
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `);
    for (const row of inserted) {
      await tx.unsafe(
        `INSERT INTO ${table} (hash, created_at) VALUES ($1, $2)`,
        [row.hash, row.createdAt]
      );
    }
  });

  return { tracked: migrations.length - missing.length, inserted };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  const sql = postgres(databaseUrl);
  try {
    const result = await syncMigrations(sql, { dryRun });
    console.log(`Already tracked: ${result.tracked}`);
    for (const row of result.inserted) {
      console.log(
        `  ${dryRun ? 'WOULD INSERT' : 'INSERTED'}: ${row.hash} (created_at: ${row.createdAt})`
      );
    }
    console.log(
      `${dryRun ? 'Would insert' : 'Inserted'}: ${result.inserted.length}`
    );
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  main().catch((error: Error) => {
    console.error('Error:', error);
    process.exitCode = 1;
  });
}
