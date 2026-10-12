import { describe, expect, test } from 'bun:test';
import type { UUID } from '@elizaos/core';
import type { Experience } from '../src/types';
import { ExperienceType, OutcomeType } from '../src/types';
import { ConfidenceDecayManager } from '../src/utils/confidenceDecay';
import { ExperienceRelationshipManager } from '../src/utils/experienceRelationships';

const DAY = 24 * 60 * 60 * 1000;

function exp(overrides: Partial<Experience>): Experience {
  return {
    id: 'e1' as UUID,
    agentId: 'a1' as UUID,
    type: ExperienceType.SUCCESS,
    outcome: OutcomeType.POSITIVE,
    context: '',
    action: 'act',
    result: '',
    learning: '',
    tags: [],
    domain: 'general',
    confidence: 0.5,
    importance: 0.5,
    createdAt: 0,
    updatedAt: 0,
    accessCount: 0,
    ...overrides,
  } as Experience;
}

describe('ConfidenceDecayManager', () => {
  test('decay never raises confidence above the original', () => {
    const manager = new ConfidenceDecayManager();
    const low = exp({ domain: 'security', confidence: 0.1, createdAt: 0 });
    expect(manager.getDecayedConfidence(low, 365 * DAY)).toBeLessThanOrEqual(
      0.1
    );
  });

  test('uses injected now and respects grace period', () => {
    const manager = new ConfidenceDecayManager();
    const e = exp({ confidence: 0.8, createdAt: 0 });
    expect(manager.getDecayedConfidence(e, 1 * DAY)).toBe(0.8);
    expect(manager.getDecayedConfidence(e, 37 * DAY)).toBeCloseTo(0.4, 5);
  });

  test('rejects invalid half-life', () => {
    expect(() => new ConfidenceDecayManager({ halfLife: 0 })).toThrow();
    expect(
      () => new ConfidenceDecayManager({ halfLife: Number.NaN })
    ).toThrow();
  });
});

describe('ExperienceRelationshipManager', () => {
  test('a contradiction matched by outcome and explicit edge is returned once', () => {
    const manager = new ExperienceRelationshipManager();
    const a = exp({ id: 'a' as UUID, outcome: OutcomeType.POSITIVE });
    const b = exp({ id: 'b' as UUID, outcome: OutcomeType.NEGATIVE });
    manager.addRelationship({
      fromId: 'a',
      toId: 'b',
      type: 'contradicts',
      strength: 0.8,
    });
    expect(manager.findContradictions(a, [a, b]).map((e) => e.id)).toEqual([
      'b',
    ]);
  });

  test('re-adding the same edge replaces it instead of duplicating', () => {
    const manager = new ExperienceRelationshipManager();
    const edge = {
      fromId: 'a',
      toId: 'b',
      type: 'contradicts' as const,
      strength: 0.8,
    };
    manager.addRelationship(edge);
    manager.addRelationship({ ...edge, strength: 0.5 });
    const rels = manager.findRelationships('a');
    expect(rels).toHaveLength(1);
    expect(rels[0]?.strength).toBe(0.5);
  });

  test('removing an experience drops edges in both directions', () => {
    const manager = new ExperienceRelationshipManager();
    manager.addRelationship({
      fromId: 'a',
      toId: 'b',
      type: 'related',
      strength: 1,
    });
    manager.addRelationship({
      fromId: 'b',
      toId: 'c',
      type: 'related',
      strength: 1,
    });
    manager.removeExperience('b');
    expect(manager.findRelationships('a')).toEqual([]);
    expect(manager.findRelationships('b')).toEqual([]);
  });
});
