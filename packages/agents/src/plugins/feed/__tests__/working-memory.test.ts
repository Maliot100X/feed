import { describe, expect, test } from 'bun:test';
import {
  type AgentWorkingMemoryState,
  addContact,
} from '../providers/working-memory';

describe('addContact', () => {
  test('moves a re-contacted user to the most-recent position', () => {
    const contact = (userId: string) => ({
      userId,
      name: userId,
      lastInteraction: '2026-01-01T00:00:00.000Z',
      context: 'ctx',
      channel: 'dm',
    });
    const memory: AgentWorkingMemoryState = {
      recentContacts: [contact('a'), contact('b'), contact('c')],
      gatheredFacts: [],
      activeThesis: null,
      recentTradeReasoning: [],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const updated = addContact(memory, {
      userId: 'c',
      name: 'c',
      context: 'new',
      channel: 'dm',
    });
    expect(updated.recentContacts.map((c) => c.userId)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(updated.recentContacts[0]?.context).toBe('new');
  });
});
