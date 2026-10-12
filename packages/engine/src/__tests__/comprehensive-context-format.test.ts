import { describe, expect, test } from 'bun:test';
import {
  type ComprehensiveNPCContext,
  formatComprehensiveContext,
} from '../utils/context-builder';

const baseContext: ComprehensiveNPCContext = {
  personalEvents: [
    {
      type: 'leak',
      description: 'Personal leak',
      timestamp: '2026-01-05T12:00:00Z',
    },
  ],
  recentEvents: [{ type: 'rumor', description: 'Late-run rumor', day: 45 }],
  previousPosts: [
    { content: 'An old post', timestamp: '2026-01-04T12:00:00Z' },
  ],
};

describe('formatComprehensiveContext', () => {
  test('labels simulation events with their real day (no month rollover)', () => {
    const text = formatComprehensiveContext(baseContext);
    expect(text).toContain('Day 45: [rumor] Late-run rumor');
  });

  test('keeps sections in priority order (deterministic)', () => {
    const first = formatComprehensiveContext(baseContext);
    for (let i = 0; i < 5; i++) {
      expect(formatComprehensiveContext(baseContext)).toBe(first);
    }
    const personal = first.indexOf('EVENTS YOU WERE INVOLVED IN');
    const recent = first.indexOf('Late-run rumor');
    expect(personal).toBeGreaterThanOrEqual(0);
    expect(recent).toBeGreaterThan(personal);
  });
});
