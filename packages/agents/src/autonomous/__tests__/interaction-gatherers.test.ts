import { describe, expect, test } from 'bun:test';
import { hasAgentInAncestors } from '../utils/interaction-gatherers';

describe('hasAgentInAncestors', () => {
  test('finds the agent anywhere up the parent chain', () => {
    const map = new Map([
      ['a', { parentCommentId: null, authorId: 'agent' }],
      ['b', { parentCommentId: 'a', authorId: 'u1' }],
    ]);
    expect(
      hasAgentInAncestors(
        { parentCommentId: 'b', authorId: 'u2' },
        map,
        'agent'
      )
    ).toBe(true);
  });

  test('terminates on cyclic parent chains', () => {
    const map = new Map([
      ['a', { parentCommentId: 'b', authorId: 'u1' }],
      ['b', { parentCommentId: 'a', authorId: 'u2' }],
    ]);
    expect(
      hasAgentInAncestors(
        { parentCommentId: 'a', authorId: 'u3' },
        map,
        'agent'
      )
    ).toBe(false);
  });
});
