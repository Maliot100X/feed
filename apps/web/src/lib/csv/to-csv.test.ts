import { describe, expect, it } from 'bun:test';
import { escapeCsvCell, toCsv } from './to-csv';

describe('escapeCsvCell', () => {
  it('quotes commas, quotes and newlines per RFC 4180', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas in text but not numbers', () => {
    expect(escapeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
    expect(escapeCsvCell(-5)).toBe('-5');
  });

  it('renders missing values as empty cells', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('escapes headers and keeps header order', () => {
    expect(toCsv(['a,b', 'c'], [{ 'a,b': 1, c: 'x' }])).toBe('"a,b",c\r\n1,x');
  });
});
