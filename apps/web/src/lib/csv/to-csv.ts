type CsvValue = string | number | boolean | null | undefined;

/**
 * Escape one CSV cell (RFC 4180): quote when needed, double embedded quotes,
 * keep real newlines. Text that a spreadsheet would evaluate as a formula
 * (leading =, +, -, @, tab or CR) is prefixed with an apostrophe.
 */
export function escapeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Build a CSV document from rows using a fixed, ordered header list. */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<Record<string, CsvValue>>
): string {
  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(',')),
  ].join('\r\n');
}
