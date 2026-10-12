import { describe, expect, test } from 'bun:test';
import { encodingForModel as fullEncoding } from 'js-tiktoken';
import { encodingForModel } from '../../../apps/web/cloudflare-tokenizer';

describe('Cloudflare tokenizer compatibility', () => {
  for (const model of ['gpt-4o-mini', 'gpt-4'] as const) {
    test(`${model} preserves multilingual token IDs`, () => {
      const text = 'Feed.fun: Hello 世界 👋 café\n{"agent":true}';
      const compact = encodingForModel(model);
      const tokens = compact.encode(text);
      expect(tokens).toEqual(fullEncoding(model).encode(text));
      expect(compact.decode(tokens)).toBe(text);
    });
  }
});
