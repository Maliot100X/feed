/**
 * Shared validation schema boundary tests: trimming, query booleans and
 * integer pagination.
 */

import { describe, expect, it } from 'bun:test';
import {
  CommentRepliesQuerySchema,
  createQueryBooleanSchema,
  createTrimmedStringSchema,
  NotificationsQuerySchema,
  OptionalQueryBooleanSchema,
  PaginationSchema,
  RegistryQuerySchema,
  SearchQuerySchema,
  UserFollowersQuerySchema,
} from '../../../shared/src/validation/schemas';

describe('createTrimmedStringSchema', () => {
  const schema = createTrimmedStringSchema(1, 5);

  it('rejects whitespace-only content when a minimum is set', () => {
    expect(schema.safeParse('   ').success).toBe(false);
    expect(schema.safeParse('\n\t ').success).toBe(false);
  });

  it('normalizes padded content and applies max to the trimmed value', () => {
    expect(schema.parse('  hello  ')).toBe('hello');
    expect(schema.safeParse('  hello!  ').success).toBe(false);
  });
});

describe('SearchQuerySchema', () => {
  it('rejects whitespace-only queries and normalizes case', () => {
    expect(SearchQuerySchema.safeParse('    ').success).toBe(false);
    expect(SearchQuerySchema.parse('  HeLLo ')).toBe('hello');
  });
});

describe('query boolean schemas', () => {
  it('parses exact true/false strings', () => {
    const schema = createQueryBooleanSchema(true);
    expect(schema.parse('false')).toBe(false);
    expect(schema.parse('true')).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });

  it('uses the default for absent values', () => {
    expect(createQueryBooleanSchema(true).parse(undefined)).toBe(true);
    expect(createQueryBooleanSchema(false).parse(null)).toBe(false);
    expect(createQueryBooleanSchema(false).parse('')).toBe(false);
    expect(OptionalQueryBooleanSchema.parse(null)).toBeUndefined();
  });

  it('rejects unknown strings', () => {
    expect(createQueryBooleanSchema(false).safeParse('yes').success).toBe(
      false
    );
    expect(OptionalQueryBooleanSchema.safeParse('0').success).toBe(false);
  });

  it('NotificationsQuerySchema keeps unreadOnly=false as false', () => {
    expect(
      NotificationsQuerySchema.parse({ unreadOnly: 'false' }).unreadOnly
    ).toBe(false);
    expect(
      NotificationsQuerySchema.parse({ unreadOnly: 'true' }).unreadOnly
    ).toBe(true);
    expect(NotificationsQuerySchema.parse({}).unreadOnly).toBe(false);
  });

  it('route-style null inputs fall back to defaults', () => {
    expect(
      UserFollowersQuerySchema.parse({ includeMutual: null }).includeMutual
    ).toBe(false);
    expect(
      RegistryQuerySchema.parse({ onChainOnly: 'false' }).onChainOnly
    ).toBe(false);
  });
});

describe('integer pagination', () => {
  it('rejects fractional page/limit', () => {
    expect(PaginationSchema.safeParse({ page: '1.5' }).success).toBe(false);
    expect(PaginationSchema.safeParse({ limit: 2.5 }).success).toBe(false);
    expect(CommentRepliesQuerySchema.safeParse({ page: 1.5 }).success).toBe(
      false
    );
  });

  it('applies defaults and accepts boundaries', () => {
    expect(PaginationSchema.parse({})).toMatchObject({ page: 1, limit: 20 });
    expect(PaginationSchema.parse({ page: '1', limit: '100' })).toMatchObject({
      page: 1,
      limit: 100,
    });
    expect(PaginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(PaginationSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('rejects fractional and negative offsets', () => {
    expect(RegistryQuerySchema.safeParse({ offset: '1.5' }).success).toBe(
      false
    );
    expect(RegistryQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(RegistryQuerySchema.parse({ offset: '0' }).offset).toBe(0);
  });
});
