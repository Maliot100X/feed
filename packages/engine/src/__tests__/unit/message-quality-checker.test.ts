import { describe, expect, test } from 'bun:test';
import { MessageQualityChecker } from '../../services/message-quality-checker';

describe('MessageQualityChecker', () => {
  test('URL limit is enforced even when a soft check fires first', async () => {
    const result = await MessageQualityChecker.checkQuality(
      'LOOK AT THIS NOW!!!!! http://a.example http://b.example http://c.example',
      'user-1',
      'groupchat',
      '' // empty contextId skips the DB uniqueness lookup
    );
    expect(result.errors).toContain('Too many URLs in message');
    expect(result.passed).toBe(false);
  });

  test('normalization keeps non-Latin letters', () => {
    expect(MessageQualityChecker.normalizeText('Привет, мир!')).toBe(
      'привет мир'
    );
    expect(MessageQualityChecker.normalizeText('你好 世界')).toBe('你好 世界');
  });

  test('different non-Latin messages are not treated as duplicates', () => {
    const a = MessageQualityChecker.normalizeText('Привет всем');
    const b = MessageQualityChecker.normalizeText('Как дела у вас');
    expect(MessageQualityChecker.calculateSimilarity(a, b)).toBe(0);
  });

  test('emoji-only messages normalize to empty and are never duplicates', () => {
    const a = MessageQualityChecker.normalizeText('🔥🔥');
    const b = MessageQualityChecker.normalizeText('🚀');
    expect(MessageQualityChecker.calculateSimilarity(a, b)).toBe(0);
  });
});
