/**
 * The SQL and JavaScript capital-base computations agree for reversal rows,
 * including malformed JSON, non-numeric and negative requested amounts.
 *
 * Requires DATABASE_URL (any PostgreSQL 16+; no tables are touched).
 */

import { describe, expect, it } from 'bun:test';
import {
  buildCapitalBaseContributionSql,
  db,
  getCapitalBaseContributionAmount,
  sql,
} from '@feed/db';

const cases: Array<{ amount: string; description: string | null }> = [
  { amount: '-500', description: '{"balanceUnitsRequested": 500}' },
  { amount: '-300', description: '{"balanceUnitsRequested": -800}' },
  { amount: '-300', description: '{"balanceUnitsRequested": "250.5"}' },
  { amount: '-300', description: '{"balanceUnitsRequested": "abc"}' },
  { amount: '-300', description: '{"balanceUnitsRequested": "1e3"}' },
  { amount: '-300', description: '{"balanceUnitsRequested": ""}' },
  { amount: '-300', description: '{"balanceUnitsRequested": null}' },
  { amount: '-300', description: '{not json' },
  { amount: '-300', description: 'plain text' },
  { amount: '-300', description: null },
];

describe('capital base contribution SQL/JS parity', () => {
  it.each(cases)('agrees for %p', async ({ amount, description }) => {
    const expected = getCapitalBaseContributionAmount(
      { type: 'stripe_refund', amount, description },
      'wallet'
    );
    const expression = buildCapitalBaseContributionSql('t', 'wallet');
    const result = await db.execute(
      // MATERIALIZED keeps the inputs row-valued (as in production) instead
      // of letting the planner constant-fold the CASE branches.
      sql`WITH t AS MATERIALIZED (SELECT 'stripe_refund'::text AS "type", ${amount}::text AS "amount", ${description}::text AS "description") SELECT (${sql.raw(expression)})::float8 AS value FROM t`
    );
    const rows = result as unknown as Array<{ value: number }>;
    expect(Number(rows[0]?.value)).toBe(expected);
  });
});
