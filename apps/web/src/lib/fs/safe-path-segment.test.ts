import { describe, expect, it } from 'bun:test';
import { isSafePathSegment } from './safe-path-segment';

describe('isSafePathSegment', () => {
  it('accepts plain trace and call IDs', () => {
    expect(isSafePathSegment('tick-2024-01-01_123')).toBe(true);
    expect(isSafePathSegment('call-001-x')).toBe(true);
  });

  it.each([
    '..',
    '.',
    '../etc',
    'a/b',
    'a\\b',
    '',
    '%2e%2e',
  ])('rejects %p', (value) => {
    expect(isSafePathSegment(value)).toBe(false);
  });
});
