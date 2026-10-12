export type PeriodType = 'day' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC-anchored, half-open [start, end) analytics window plus the ordered
 * bucket keys it covers.
 *
 * - day:   7 daily buckets ending with today (UTC)
 * - week:  28 daily buckets ending with today (UTC)
 * - month: 6 calendar-month buckets ending with the current month (UTC),
 *          starting on the 1st so no partial or skipped months occur
 *
 * Keys match the SQL bucket labels: `YYYY-MM-DD` for daily buckets
 * (DATE(createdAt)) and `YYYY-MM` for monthly buckets.
 */
export function getAnalyticsBuckets(
  period: PeriodType,
  now: Date = new Date()
): { start: Date; end: Date; keys: string[] } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (period === 'month') {
    const start = new Date(Date.UTC(year, month - 5, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    const keys: string[] = [];
    for (let i = 0; i < 6; i++) {
      const bucket = new Date(Date.UTC(year, month - 5 + i, 1));
      keys.push(
        `${bucket.getUTCFullYear()}-${String(bucket.getUTCMonth() + 1).padStart(2, '0')}`
      );
    }
    return { start, end, keys };
  }

  const days = period === 'week' ? 28 : 7;
  const end = new Date(Date.UTC(year, month, now.getUTCDate() + 1));
  const start = new Date(end.getTime() - days * DAY_MS);
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    keys.push(
      new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10)
    );
  }
  return { start, end, keys };
}
