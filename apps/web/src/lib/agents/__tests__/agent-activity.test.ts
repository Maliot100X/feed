import { describe, expect, it } from 'bun:test';
import {
  type AgentActivity,
  mergeAgentActivities,
  parseAgentActivityQuery,
} from '../agent-activity';

function post(id: string, timestamp: string): AgentActivity {
  return {
    type: 'post',
    id,
    agentId: 'agent-1',
    timestamp,
    data: { postId: id, contentPreview: id },
  };
}

function comment(id: string, timestamp: string): AgentActivity {
  return {
    type: 'comment',
    id,
    agentId: 'agent-1',
    timestamp,
    data: {
      commentId: id,
      postId: 'p',
      contentPreview: id,
      parentCommentId: null,
    },
  };
}

describe('parseAgentActivityQuery', () => {
  it('defaults absent params (URLSearchParams.get returns null)', () => {
    expect(parseAgentActivityQuery(new URLSearchParams())).toEqual({
      limit: 50,
      type: 'all',
    });
  });

  it('rejects invalid values', () => {
    expect(() =>
      parseAgentActivityQuery(new URLSearchParams('limit=abc'))
    ).toThrow();
    expect(() =>
      parseAgentActivityQuery(new URLSearchParams('type=likes'))
    ).toThrow();
  });
});

describe('mergeAgentActivities', () => {
  it('reports hasMore=false at exactly limit rows', () => {
    const result = mergeAgentActivities(
      [[post('a', '2026-01-02T00:00:00Z'), post('b', '2026-01-01T00:00:00Z')]],
      2
    );
    expect(result.hasMore).toBe(false);
    expect(result.activities.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('reports hasMore=true for a single source with limit + 1 rows', () => {
    const result = mergeAgentActivities(
      [
        [
          post('a', '2026-01-03T00:00:00Z'),
          post('b', '2026-01-02T00:00:00Z'),
          post('c', '2026-01-01T00:00:00Z'),
        ],
      ],
      2
    );
    expect(result.hasMore).toBe(true);
    expect(result.activities.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('merges sources newest first with a stable tie-break', () => {
    const same = '2026-01-01T00:00:00Z';
    const result = mergeAgentActivities(
      [
        [post('p1', same)],
        [comment('c1', '2026-01-02T00:00:00Z'), comment('c0', same)],
      ],
      10
    );
    expect(result.activities.map((a) => a.id)).toEqual(['c1', 'c0', 'p1']);
  });
});
