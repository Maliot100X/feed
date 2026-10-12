import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { selectPostIntent } from '../../services/post-intent-service';
import type { Actor } from '../../types/shared';

const actor = {
  id: 'post-intent-test-actor',
  name: 'Test Actor',
  domain: ['comedy'],
} as Actor;
const other = { id: 'post-intent-other', name: 'Other', domain: [] } as Actor;

describe('selectPostIntent (non-finance)', () => {
  afterEach(() => {
    (Math.random as unknown as { mockRestore?: () => void }).mockRestore?.();
  });

  test('topical bucket without a trending topic becomes organic, not social', () => {
    spyOn(Math, 'random').mockReturnValue(0.2);
    expect(selectPostIntent(actor, undefined, [], [actor, other])).toEqual({
      type: 'organic',
    });
  });

  test('social bucket still selects a social target', () => {
    spyOn(Math, 'random').mockReturnValue(0.5);
    expect(selectPostIntent(actor, undefined, [], [actor, other]).type).toBe(
      'social'
    );
  });
});
