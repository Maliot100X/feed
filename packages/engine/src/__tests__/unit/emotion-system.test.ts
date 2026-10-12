import { describe, expect, test } from 'bun:test';
import {
  generateActorContext,
  getRelationshipModifier,
  moodToEmotion,
} from '../../EmotionSystem';

describe('EmotionSystem', () => {
  test('rejects non-finite mood instead of reporting extreme fury', () => {
    expect(() => moodToEmotion(Number.NaN)).toThrow(RangeError);
    expect(() => moodToEmotion(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  test('intensity thresholds: 0.3 is moderately, 0.6 is extremely', () => {
    expect(moodToEmotion(0.3).intensity).toBe('moderately');
    expect(moodToEmotion(0.6).intensity).toBe('extremely');
    expect(generateActorContext(0.6, 'high')).toContain(
      'Current mood: extremely happy'
    );
  });

  test('prototype keys fall back to the neutral relationship', () => {
    expect(getRelationshipModifier('constructor')).toEqual(
      getRelationshipModifier('neutral')
    );
    expect(getRelationshipModifier('toString').sentimentBonus).toBe(0);
    expect(getRelationshipModifier('Rival').sentimentBonus).toBe(-0.3);
  });
});
