/**
 * A2A validation schemas used by the executor.
 */

import { describe, expect, it } from 'bun:test';
import { OffsetPaginationSchema } from '../../../a2a/src/validation';

describe('OffsetPaginationSchema', () => {
  it('applies defaults', () => {
    expect(OffsetPaginationSchema.parse({})).toEqual({ offset: 0, limit: 10 });
  });

  it('coerces numeric strings from query params', () => {
    expect(OffsetPaginationSchema.parse({ offset: '20', limit: '50' })).toEqual(
      { offset: 20, limit: 50 }
    );
  });

  it.each([
    [{ offset: -1 }],
    [{ offset: 1.5 }],
    [{ limit: 0 }],
    [{ limit: 101 }],
    [{ limit: '2.5' }],
    [{ limit: 'abc' }],
  ])('rejects invalid pagination %p', (input) => {
    expect(OffsetPaginationSchema.safeParse(input).success).toBe(false);
  });
});
