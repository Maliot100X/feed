/**
 * Game Output Validation Tests
 * Ensures generated games have correct structure and content
 *
 * NOTE: This test suite requires LLM API keys (GROQ_API_KEY or OPENAI_API_KEY)
 * and takes 1-5 minutes to run due to game generation.
 * Tests will skip gracefully if rate limited or API unavailable.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { resolveLiveLlmTestConfig } from '../../../../testing/integration/helpers/live-runtime';
import type { GeneratedGame } from '../../GameGenerator';
import { GameGenerator } from '../../GameGenerator';

const liveLlmConfig = resolveLiveLlmTestConfig();

describe.skipIf(!liveLlmConfig.enabled)('Game Output Validation', () => {
  let game: GeneratedGame | null = null;

  // Live generation is explicitly opted into (RUN_LIVE_LLM_TESTS), so
  // generation failures fail the suite instead of turning every test green.
  beforeAll(async () => {
    const generator = new GameGenerator();
    game = await generator.generateCompleteGame();
  }, 600_000);

  describe('Schema Validation', () => {
    test('has all required top-level fields', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.id).toBeDefined();
      expect(game.version).toBeDefined();
      expect(game.generatedAt).toBeDefined();
      expect(game.setup).toBeDefined();
      expect(game.timeline).toBeDefined();
      expect(game.resolution).toBeDefined();
    });

    test('has all 30 days in timeline', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.timeline.length).toBe(30);

      game.timeline.forEach((day, i) => {
        expect(day.day).toBe(i + 1);
      });
    });

    test('has 3 main actors', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.setup.mainActors.length).toBe(3);
    });

    test('has 15 supporting actors', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.setup.supportingActors.length).toBe(15);
    });

    test('has extras', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.setup.extras.length).toBeGreaterThan(0);
    });

    test('has 3 scenarios', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.setup.scenarios.length).toBe(3);
    });

    test('has 3 questions', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.setup.questions.length).toBe(3);
    });

    test('has group chats', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.setup.groupChats.length).toBeGreaterThan(0);
    });

    test('all questions have outcomes', () => {
      if (!game) throw new Error('Game was not generated');
      game.setup.questions.forEach((q) => {
        expect(typeof q.outcome).toBe('boolean');
      });
    });
  });

  describe('Content Validation', () => {
    test('events reference valid actors', () => {
      if (!game) throw new Error('Game was not generated');
      const allActorIds = [
        ...game.setup.mainActors.map((a) => a.id),
        ...game.setup.supportingActors.map((a) => a.id),
        ...game.setup.extras.map((a) => a.id),
      ];

      game.timeline.forEach((day) => {
        day.events.forEach((event) => {
          event.actors.forEach((actorId) => {
            expect(allActorIds).toContain(actorId);
          });
        });
      });
    });

    test('each day has events', () => {
      if (!game) throw new Error('Game was not generated');
      game.timeline.forEach((day) => {
        expect(day.events.length).toBeGreaterThan(0);
      });
    });

    test('group chats have valid members', () => {
      if (!game) throw new Error('Game was not generated');
      const allActorIds = [
        ...game.setup.mainActors.map((a) => a.id),
        ...game.setup.supportingActors.map((a) => a.id),
        ...game.setup.extras.map((a) => a.id),
      ];

      game.setup.groupChats.forEach((chat) => {
        expect(chat.members.length).toBeGreaterThan(0);
        chat.members.forEach((memberId) => {
          expect(allActorIds).toContain(memberId);
        });
      });
    });

    test('events have unique IDs', () => {
      if (!game) throw new Error('Game was not generated');
      const eventIds = new Set<string>();

      game.timeline.forEach((day) => {
        day.events.forEach((event) => {
          expect(eventIds.has(event.id)).toBe(false);
          eventIds.add(event.id);
        });
      });
    });

    test('timestamps are valid', () => {
      if (!game) throw new Error('Game was not generated');
      const generatedAt = new Date(game.generatedAt);
      expect(generatedAt.getTime()).toBeGreaterThan(0);
    });
  });

  describe('Narrative Coherence', () => {
    test('scenarios connect to questions', () => {
      if (!game) throw new Error('Game was not generated');
      game.setup.questions.forEach((q) => {
        expect(q.scenario).toBeGreaterThanOrEqual(1);
        expect(q.scenario).toBeLessThanOrEqual(3);
      });
    });

    test('events distributed across days', () => {
      if (!game) throw new Error('Game was not generated');
      const eventCounts = game.timeline.map((d) => d.events.length);
      const total = eventCounts.reduce((sum, c) => sum + c, 0);

      expect(total).toBeGreaterThan(30); // At least 1 per day
    });

    test('has resolution for all questions', () => {
      if (!game) throw new Error('Game was not generated');
      expect(game.resolution.outcomes.length).toBe(3);

      game.resolution.outcomes.forEach((outcome) => {
        expect(typeof outcome.answer).toBe('boolean');
        expect(outcome.explanation).toBeDefined();
      });
    });
  });

  describe('Quality Validation', () => {
    test('early (days 1-10) and late (days 21-25) windows both have events', () => {
      if (!game) throw new Error('Game was not generated');
      const earlyEvents = game.timeline
        .slice(0, 10)
        .reduce((sum, d) => sum + d.events.length, 0);
      const lateEvents = game.timeline
        .slice(20, 25)
        .reduce((sum, d) => sum + d.events.length, 0);

      expect(earlyEvents).toBeGreaterThan(0);
      expect(lateEvents).toBeGreaterThan(0);
    });

    test('file size is reasonable (<10MB)', () => {
      if (!game) throw new Error('Game was not generated');
      const json = JSON.stringify(game);
      const sizeInMB = Buffer.byteLength(json, 'utf8') / (1024 * 1024);

      expect(sizeInMB).toBeLessThan(10);
    });
  });
});
