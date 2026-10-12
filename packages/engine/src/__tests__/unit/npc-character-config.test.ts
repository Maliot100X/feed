/**
 * Tests for NPC Character Configuration
 *
 * Verifies that character-specific configs, voice patterns,
 * and domain matching work correctly.
 */

import { describe, expect, it } from 'vitest';
import {
  checkVoiceConsistency,
  deriveVoicePatterns,
  getActorRivals,
  getCharacterConfig,
  getCharacterConfigOrDefault,
  getCharacterTemperature,
  getConfiguredCharacters,
  getTemplatePosts,
  shouldGenerateOrganicPost,
  shouldPostAboutTopic,
} from '../../services/npc-character-config';

describe('NPC Character Config', () => {
  describe('getCharacterConfig', () => {
    it('should return specific config for configured characters', () => {
      const kanyaiConfig = getCharacterConfig('kanyai-west');

      expect(kanyaiConfig.temperature).toBe(0.95);
      expect(kanyaiConfig.personalityType).toBe('chaotic');
      expect(kanyaiConfig.domains).toContain('music');
      expect(kanyaiConfig.domains).toContain('fashion');
    });

    it('should throw for unknown characters (fail-fast)', () => {
      expect(() => getCharacterConfig('unknown-actor-xyz')).toThrow(
        "Actor 'unknown-actor-xyz' not found in StaticDataRegistry"
      );
    });

    it('should return default config for unknown characters via getCharacterConfigOrDefault', () => {
      const unknownConfig = getCharacterConfigOrDefault('unknown-actor-xyz');

      expect(unknownConfig.temperature).toBe(0.8);
      expect(unknownConfig.personalityType).toBe('default');
      expect(unknownConfig.domains).toEqual([]);
    });

    it('should have different temperatures for different personality types', () => {
      const kanyaiTemp = getCharacterTemperature('kanyai-west');
      const dairiioTemp = getCharacterTemperature('dairiio-amodei');
      const trumpTemp = getCharacterTemperature('trump-terminal');

      // Chaotic (KanyAI) should be highest (0.95)
      expect(kanyaiTemp).toBe(0.95);
      // Trump is "narcissistic showman" which matches provocative (0.9)
      expect(trumpTemp).toBe(0.9);
      // Dairiio is "safety theater director" which matches corporate (0.6)
      expect(dairiioTemp).toBe(0.6);
      // Chaotic > Provocative > Corporate
      expect(kanyaiTemp).toBeGreaterThan(trumpTemp);
      expect(trumpTemp).toBeGreaterThan(dairiioTemp);
    });
  });

  describe('checkVoiceConsistency', () => {
    it('should match voice patterns for KanyAI-style posts', () => {
      const result = checkVoiceConsistency(
        'kanyai-west',
        'I AM THE GREATEST ARTIST OF ALL TIME.'
      );

      expect(result.matchesVoice).toBe(true);
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
      expect(result.voiceScore).toBeGreaterThan(0);
    });

    it('should detect when voice patterns are not matched for KanyAI', () => {
      // KanyAI should use ALL CAPS - lowercase text won't match
      const result = checkVoiceConsistency(
        'kanyai-west',
        'I am cautiously optimistic about the market analysis.'
      );

      // Lowercase text doesn't match ALL CAPS pattern
      expect(result.matchedPatterns.length).toBe(0);
      expect(result.voiceScore).toBe(0);
    });

    it('should match voice patterns for Trump Terminal-style posts', () => {
      // Trump's postStyle includes "ALL CAPS frequently" and "Exclamation marks"
      const result = checkVoiceConsistency(
        'trump-terminal',
        'TOTAL DISASTER!! THE FAKE NEWS IS AT IT AGAIN!! HUGE!!'
      );

      // Should match ALL CAPS and exclamation patterns
      expect(result.matchedPatterns.length).toBeGreaterThan(0);
      expect(result.matchesVoice).toBe(true);
    });

    it('should work for unknown characters (no patterns to check)', () => {
      const result = checkVoiceConsistency(
        'unknown-actor',
        'Any content here.'
      );

      expect(result.matchesVoice).toBe(true); // No patterns = not blocking
      expect(result.voiceScore).toBeNull(); // ...but voice is unmeasured
    });
  });

  describe('shouldPostAboutTopic', () => {
    it('should return true for on-domain topics', () => {
      expect(
        shouldPostAboutTopic(
          'dairiio-amodei',
          'Will AI safety regulations pass?'
        )
      ).toBe(true);

      expect(
        shouldPostAboutTopic('brian-airmstrong', 'Bitcoin ETF approval coming?')
      ).toBe(true);
    });

    it('should return true for unknown actors (no domain restrictions)', () => {
      expect(
        shouldPostAboutTopic('unknown-actor', 'Random topic about anything')
      ).toBe(true);
    });

    it('should match domain keywords expansions', () => {
      // "ai" domain should match "artificial intelligence"
      expect(
        shouldPostAboutTopic(
          'sam-ailtman',
          'Will artificial intelligence become superintelligent?'
        )
      ).toBe(true);

      // "crypto" domain should match "blockchain"
      expect(
        shouldPostAboutTopic('vitailik-buterin', 'New blockchain protocol?')
      ).toBe(true);
    });
  });

  describe('shouldGenerateOrganicPost', () => {
    it('should have higher organic probability for chaotic characters', () => {
      const kanyaiConfig = getCharacterConfig('kanyai-west');
      const dairiioConfig = getCharacterConfig('dairiio-amodei');

      expect(kanyaiConfig.organicPostProbability).toBeGreaterThan(
        dairiioConfig.organicPostProbability
      );
    });

    it('should return a boolean', () => {
      const result = shouldGenerateOrganicPost('kanyai-west');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getTemplatePosts', () => {
    it('should return template posts for configured characters', () => {
      const templates = getTemplatePosts('kanyai-west', 3);

      expect(templates.length).toBeLessThanOrEqual(3);
      expect(templates.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown characters', () => {
      const templates = getTemplatePosts('unknown-actor', 5);

      expect(templates).toEqual([]);
    });

    it('orders templates by the injected RNG', () => {
      const all = getTemplatePosts('trump-terminal', 100, () => 0.999);
      expect(all.length).toBeGreaterThan(1);

      // Same RNG sequence -> same order
      const seq = () => {
        let i = 0;
        const values = [0.1, 0.7, 0.3, 0.9, 0.5];
        return () => values[i++ % values.length]!;
      };
      expect(getTemplatePosts('trump-terminal', 3, seq())).toEqual(
        getTemplatePosts('trump-terminal', 3, seq())
      );

      // Different RNG -> different order of the full set
      const reversed = getTemplatePosts('trump-terminal', 100, () => 0);
      expect(reversed).not.toEqual(all);
      expect([...reversed].sort()).toEqual([...all].sort());
    });
  });

  describe('getActorRivals', () => {
    it('should return rivals for characters with defined rivalries', () => {
      const trumpRivals = getActorRivals('trump-terminal');

      expect(trumpRivals).toContain('nancy-pelosai');
    });

    it('should return empty array for characters without rivals', () => {
      const billRivals = getActorRivals('baill-gaites');

      expect(billRivals).toEqual([]);
    });

    it('should have bidirectional rivalries where defined', () => {
      const samRivals = getActorRivals('sam-ailtman');
      const dairiioRivals = getActorRivals('dairiio-amodei');

      // Sam AIltman and Dairiio AmodAI are rivals
      expect(samRivals).toContain('dairiio-amodei');
      expect(dairiioRivals).toContain('sam-ailtman');
    });
  });

  describe('getConfiguredCharacters', () => {
    it('should return list of all configured character IDs', () => {
      const chars = getConfiguredCharacters();

      expect(chars).toContain('kanyai-west');
      expect(chars).toContain('trump-terminal');
      expect(chars).toContain('dairiio-amodei');
      expect(chars.length).toBeGreaterThan(10);
    });
  });

  describe('hardening', () => {
    it('does not treat "no caps" style as an all-caps requirement', () => {
      expect(deriveVoicePatterns('no caps, lowercase only')).toEqual([]);
      expect(deriveVoicePatterns('Avoid all caps')).toEqual([]);
      expect(deriveVoicePatterns('ALL CAPS frequently')).toHaveLength(1);
    });

    it('empty content is unmeasured voice', () => {
      expect(checkVoiceConsistency('kanyai-west', '   ').voiceScore).toBeNull();
    });

    it('rejects negative or fractional template counts', () => {
      expect(() => getTemplatePosts('kanyai-west', -1)).toThrow(RangeError);
      expect(() => getTemplatePosts('kanyai-west', 1.5)).toThrow(RangeError);
      expect(getTemplatePosts('kanyai-west', 0)).toEqual([]);
    });

    it('returned configs and rivals cannot mutate shared state', () => {
      const config = getCharacterConfig('trump-terminal');
      config.templatePosts.length = 0;
      config.rivals.push('someone-else');
      expect(
        getCharacterConfig('trump-terminal').templatePosts.length
      ).toBeGreaterThan(0);
      expect(getActorRivals('trump-terminal')).not.toContain('someone-else');

      const unknown = getCharacterConfigOrDefault('unknown-actor-xyz');
      unknown.domains.push('ai');
      expect(getCharacterConfigOrDefault('unknown-actor-xyz').domains).toEqual(
        []
      );
    });

    it('rival lists contain no duplicates', () => {
      const rivals = getActorRivals('trump-terminal');
      expect(new Set(rivals).size).toBe(rivals.length);
    });
  });
});
