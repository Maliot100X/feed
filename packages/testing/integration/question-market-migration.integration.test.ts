import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

test('question market migration backfills only authoritative or unambiguous links', async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = postgres(databaseUrl, { max: 1 });
  const schema = `question_link_${crypto.randomUUID().replaceAll('-', '')}`;
  const migration = await readFile(
    new URL(
      '../../db/drizzle/migrations/0070_add_question_market_link.sql',
      import.meta.url
    ),
    'utf8'
  );
  try {
    await client.begin(async (tx) => {
      await tx.unsafe(`CREATE SCHEMA "${schema}"`);
      await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.unsafe(
        'CREATE TABLE "Market" (id text PRIMARY KEY, question text NOT NULL)'
      );
      await tx.unsafe(
        'CREATE TABLE "Question" (id text PRIMARY KEY, text text NOT NULL)'
      );
      await tx.unsafe(`INSERT INTO "Market" VALUES
        ('same-id', 'Original text'), ('legacy-market', ' Legacy Text '),
        ('duplicate-a', 'Duplicate'), ('duplicate-b', 'Duplicate'),
        ('shared-market', 'Shared question'), ('blank-id', '')`);
      await tx.unsafe(`INSERT INTO "Question" VALUES
        ('same-id', 'Edited text'), ('legacy-question', 'legacy text'),
        ('ambiguous', 'Duplicate'), ('shared-a', 'Shared question'),
        ('shared-b', 'Shared question'), ('orphan', 'No market'),
        ('blank-id', 'Restored text'), ('imposter', 'Original text')`);
      await tx.unsafe(migration);
      const rows = await tx.unsafe<{ id: string; marketId: string | null }[]>(
        'SELECT id, "marketId" FROM "Question" ORDER BY id'
      );
      expect(
        Object.fromEntries(rows.map((row) => [row.id, row.marketId]))
      ).toEqual({
        ambiguous: null,
        'blank-id': 'blank-id',
        imposter: null,
        'legacy-question': 'legacy-market',
        orphan: null,
        'same-id': 'same-id',
        'shared-a': null,
        'shared-b': null,
      });
      const [market] = await tx.unsafe<{ question: string }[]>(
        `SELECT question FROM "Market" WHERE id = 'blank-id'`
      );
      expect(market?.question).toBe('Restored text');
      const [index] = await tx.unsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = 'Question_marketId_idx'`,
        [schema]
      );
      expect(index?.indexname).toBe('Question_marketId_idx');
      await tx.unsafe(`DELETE FROM "Market" WHERE id = 'same-id'`);
      const [unlinked] = await tx.unsafe<{ marketId: string | null }[]>(
        `SELECT "marketId" FROM "Question" WHERE id = 'same-id'`
      );
      expect(unlinked?.marketId).toBeNull();
      await tx.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  } finally {
    await client.end();
  }
});
