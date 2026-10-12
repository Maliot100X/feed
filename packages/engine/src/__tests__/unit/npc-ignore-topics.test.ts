/**
 * Tests for actor topic filtering (ignoreTopics + engagementThreshold).
 *
 * All randomness is injected so results are deterministic.
 */

import { describe, expect, test } from 'bun:test';
import { shouldPostAboutTopic } from '../../services/npc-character-config';
import { StaticDataRegistry } from '../../services/static-data-registry';

const always = () => 0; // randomChance(p) is true for any p > 0
const never = () => 0.999999; // randomChance(p) is false for any p < 1

describe('shouldPostAboutTopic', () => {
  test('kanyai-west has ignored topics configured', () => {
    const actor = StaticDataRegistry.getActor('kanyai-west');
    expect(actor?.ignoreTopics).toContain('sec');
    expect(actor?.ignoreTopics).toContain('regulation');
  });

  test('ignored topics are blocked even when the RNG would allow off-domain posts', () => {
    expect(
      shouldPostAboutTopic('kanyai-west', 'New SEC filing rules', always)
    ).toBe(false);
    expect(
      shouldPostAboutTopic('kanyai-west', 'Fresh regulation news', always)
    ).toBe(false);
    expect(
      shouldPostAboutTopic('kanyai-west', 'Bitcoin price prediction', always)
    ).toBe(false);
  });

  test('on-domain topics are allowed regardless of RNG', () => {
    expect(
      shouldPostAboutTopic('kanyai-west', 'New music album release', never)
    ).toBe(true);
  });

  test('off-domain topics follow the injected RNG', () => {
    const topic = 'Weekend weather forecast for the coast';
    expect(shouldPostAboutTopic('kanyai-west', topic, never)).toBe(false);
    const actor = StaticDataRegistry.getActor('kanyai-west');
    // With threshold < 1 the scaled probability is positive, so RNG=0 allows it.
    if ((actor?.engagementThreshold ?? 0.5) < 1) {
      expect(shouldPostAboutTopic('kanyai-west', topic, always)).toBe(true);
    }
  });

  test('unknown actors can post about anything', () => {
    expect(
      shouldPostAboutTopic('unknown-actor-xyz', 'SEC regulations', never)
    ).toBe(true);
    expect(shouldPostAboutTopic('unknown-actor-xyz', '', never)).toBe(true);
  });
});
