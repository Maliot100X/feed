/**
 * Fail-Fast Validation Tests
 *
 * @description
 * Ensures the system fails immediately on invalid data rather than
 * propagating bad state. Critical for data integrity.
 */

import { describe, expect, mock, test } from 'bun:test';
import { FeedGenerator } from '../FeedGenerator';
import type { FeedLLMClient } from '../llm/openai-client';

// Create a minimal mock LLM client for validation tests
function createMockLLMClient(): FeedLLMClient {
  return {
    generateText: mock(() => Promise.resolve('')),
    generateJSON: mock(() => Promise.resolve({})),
    getProvider: () => 'groq',
    getStats: () => ({
      provider: 'groq' as const,
      model: 'test',
      totalTokens: 0,
      totalCost: 0,
    }),
  } as unknown as FeedLLMClient;
}

describe('Fail-Fast Validation', () => {
  test('generateDayFeed throws on invalid day number', async () => {
    const llm = createMockLLMClient();
    const feed = new FeedGenerator(llm);

    await expect(feed.generateDayFeed(0, [], [])).rejects.toThrow(
      'day must be between 1 and 30'
    );

    await expect(feed.generateDayFeed(31, [], [])).rejects.toThrow(
      'day must be between 1 and 30'
    );
  });

  test('generateDayFeed throws on empty actors array', async () => {
    const llm = createMockLLMClient();
    const feed = new FeedGenerator(llm);

    await expect(feed.generateDayFeed(1, [], [])).rejects.toThrow(
      'cannot be empty'
    );
  });
});
