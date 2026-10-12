import { describe, expect, test } from 'bun:test';
import { getShuffledExamplesText } from '../../prompts/trading/npc-market-decisions';

describe('getShuffledExamplesText', () => {
  test('is reproducible with an injected RNG', () => {
    const seeded = () => {
      let x = 42;
      return () => {
        x = (x * 16807) % 2147483647;
        return x / 2147483647;
      };
    };
    expect(getShuffledExamplesText(seeded())).toBe(
      getShuffledExamplesText(seeded())
    );
  });

  test('every example includes the required narrativeConnection field', () => {
    const text = getShuffledExamplesText(() => 0.5);
    const decisions = text.match(/<decision>/g)?.length ?? 0;
    const connections = text.match(/<narrativeConnection>[^<]+</g)?.length ?? 0;
    expect(decisions).toBeGreaterThan(0);
    expect(connections).toBe(decisions);
  });
});
