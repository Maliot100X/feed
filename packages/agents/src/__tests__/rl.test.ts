/**
 * RL model configuration and context-window limits.
 */

import { describe, expect, it } from 'bun:test';
import { getModelTokenLimit, truncateToTokenLimitSync } from '@feed/api';
import { getRLModelConfig } from '@feed/training';

describe('RL Training System', () => {
  describe('Configuration', () => {
    it('should have a valid base model configured', () => {
      const config = getRLModelConfig();
      // Base model can be OpenPipe or unsloth variants
      expect(config.baseModel).toBeDefined();
      expect(config.baseModel.length).toBeGreaterThan(0);
    });

    it('should have Atropos configuration if enabled', () => {
      const config = getRLModelConfig();

      if (config.enabled) {
        expect(config.atroposApiUrl).toBeDefined();
        expect(config.vllmPort).toBeDefined();
      }
    });
  });

  describe('Context Window Safety', () => {
    it('should enforce 128K limit for unsloth models', async () => {
      const limit = getModelTokenLimit('unsloth/Qwen3-4B-128K');

      // unsloth/Qwen3-4B-128K has 128K context (131072 tokens)
      expect(limit).toBe(131072);
    });

    it('should have truncation utilities available', async () => {
      const longText = 'a'.repeat(200000); // Very long text
      const result = truncateToTokenLimitSync(longText, 1000, {
        ellipsis: true,
      });

      expect(result.tokens).toBeLessThanOrEqual(1000);
      expect(result.text.length).toBeLessThan(longText.length);
    });
  });
});
