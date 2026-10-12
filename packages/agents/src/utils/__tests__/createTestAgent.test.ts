import { describe, expect, test } from 'bun:test';
import { testAgentUsernamePattern } from '../createTestAgent';

describe('testAgentUsernamePattern', () => {
  test('anchors to the generated "<prefix>-" namespace', () => {
    expect(testAgentUsernamePattern('bench')).toBe('bench-%');
  });

  test('escapes LIKE metacharacters so they cannot broaden the match', () => {
    expect(testAgentUsernamePattern('a%b_c')).toBe('a\\%b\\_c-%');
    expect(testAgentUsernamePattern('a\\b')).toBe('a\\\\b-%');
  });

  test('rejects an empty prefix (would match every hyphenated username)', () => {
    expect(() => testAgentUsernamePattern('')).toThrow();
  });
});
