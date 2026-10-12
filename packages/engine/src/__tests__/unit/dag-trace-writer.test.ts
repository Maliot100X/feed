import { describe, expect, test } from 'bun:test';
import { npcTrajectoryFileName, parseTraceKeep } from '../../dag-trace/writer';

describe('parseTraceKeep', () => {
  test('uses default when unset or blank', () => {
    expect(parseTraceKeep(undefined)).toBe(100);
    expect(parseTraceKeep('')).toBe(100);
    expect(parseTraceKeep('  ')).toBe(100);
  });

  test('accepts positive integers', () => {
    expect(parseTraceKeep('1')).toBe(1);
    expect(parseTraceKeep('25')).toBe(25);
  });

  test('rejects zero, negative, fractional and non-numeric values', () => {
    for (const raw of ['0', '-5', '2.5', 'abc', 'NaN', 'Infinity']) {
      expect(() => parseTraceKeep(raw)).toThrow('FEED_DAG_TRACE_KEEP');
    }
  });
});

describe('npcTrajectoryFileName', () => {
  test('keys files by npcId so same-named NPCs do not collide', () => {
    expect(npcTrajectoryFileName('npc-1')).not.toBe(
      npcTrajectoryFileName('npc-2')
    );
    expect(npcTrajectoryFileName('ailon-musk')).toBe('ailon-musk.json');
  });

  test('strips path separators', () => {
    expect(npcTrajectoryFileName('../evil/id')).toBe('-evil-id.json');
  });
});
