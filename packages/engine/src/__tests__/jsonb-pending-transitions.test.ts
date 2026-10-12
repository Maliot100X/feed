import { describe, expect, test } from 'bun:test';
import {
  PendingTransitionSchema,
  parsePendingTransitionsSafe,
} from '../services/jsonb-validators';

describe('PendingTransition validation', () => {
  test('accepts a known arc state', () => {
    expect(
      PendingTransitionSchema.safeParse({
        targetState: 'crisis',
        triggerDay: 3,
      }).success
    ).toBe(true);
  });

  test('rejects unknown arc states and invalid trigger days', () => {
    expect(
      PendingTransitionSchema.safeParse({ targetState: 'bogus', triggerDay: 3 })
        .success
    ).toBe(false);
    expect(
      PendingTransitionSchema.safeParse({
        targetState: 'setup',
        triggerDay: -1,
      }).success
    ).toBe(false);
    expect(
      PendingTransitionSchema.safeParse({
        targetState: 'setup',
        triggerDay: 1.5,
      }).success
    ).toBe(false);
  });

  test('salvage path drops entries with unknown target states', () => {
    expect(
      parsePendingTransitionsSafe([
        { targetState: 'setup', triggerDay: 1 },
        { targetState: 'not-a-state', triggerDay: 2 },
      ])
    ).toEqual([{ targetState: 'setup', triggerDay: 1 }]);
  });
});
