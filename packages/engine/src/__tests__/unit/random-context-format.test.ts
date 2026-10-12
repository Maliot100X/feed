import { describe, expect, test } from 'bun:test';
import { formatRandomContext } from '../../prompts/random-context';

describe('formatRandomContext', () => {
  test('does not invent authors or like counts for recent posts', () => {
    const text = formatRandomContext({
      recentPosts: [
        { author: 'Alice', content: 'hello' },
        { author: null, content: 'anonymous' },
      ],
    });
    expect(text).toContain('Recent Posts');
    expect(text).toContain('@Alice: "hello"');
    expect(text).toContain('- "anonymous"');
    expect(text).not.toContain('Unknown');
    expect(text).not.toContain('likes');
  });

  test('labels price moves as lifetime (since listing)', () => {
    const text = formatRandomContext({
      gainers: [{ name: 'Acme', price: 12, change: 20 }],
    });
    expect(text).toContain('Top Gainers (since listing): Acme (+20.0%)');
  });
});
