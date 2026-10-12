import { describe, expect, test } from 'bun:test';
import {
  validateCharacterLimit,
  validateFeedPost,
  validateNoRealNames,
} from '../../prompts/validate-output';

describe('validate-output', () => {
  test('empty or whitespace-only posts are invalid', () => {
    const result = validateFeedPost('   ', {
      maxLength: 280,
      postType: 'AMBIENT',
    });
    expect(result.isValid).toBe(false);
    expect(result.violations.some((v) => v.startsWith('EMPTY'))).toBe(true);
  });

  test('invalid maxLength is rejected instead of silently passing', () => {
    expect(() => validateCharacterLimit('hi', Number.NaN, 'AMBIENT')).toThrow();
    expect(() => validateCharacterLimit('hi', 0, 'AMBIENT')).toThrow();
  });

  test('ordinary words that are also brand names are allowed', () => {
    expect(
      validateNoRealNames(
        'Cautious optimism as the avalanche of compound interest hits a polygon.'
      )
    ).toEqual([]);
  });

  test('real names are still rejected, once per occurrence', () => {
    const violations = validateNoRealNames('Elon Musk tweeted again');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    const mentions = violations.filter((v) => /elon\s*musk/i.test(v));
    expect(mentions.length).toBe(1);
  });
});
