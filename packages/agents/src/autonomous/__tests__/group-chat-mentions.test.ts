import { describe, expect, test } from 'bun:test';
import { hasUnansweredMention } from '../AutonomousGroupChatService';

const AGENT = 'agent-1';

describe('hasUnansweredMention', () => {
  test('detects a mention with no prior agent reply', () => {
    expect(
      hasUnansweredMention(
        [{ senderId: 'u1', content: 'hey Alpha Bot what do you think?' }],
        AGENT,
        'Alpha Bot'
      )
    ).toBe(true);
  });

  test('ignores a mention the agent already replied to', () => {
    // newest first: agent reply came after the mention
    expect(
      hasUnansweredMention(
        [
          { senderId: AGENT, content: 'I think yes' },
          { senderId: 'u1', content: 'alpha bot thoughts?' },
        ],
        AGENT,
        'Alpha Bot'
      )
    ).toBe(false);
  });

  test('detects a new mention after the agent reply', () => {
    expect(
      hasUnansweredMention(
        [
          { senderId: 'u2', content: 'Alpha Bot, follow up?' },
          { senderId: AGENT, content: 'I think yes' },
          { senderId: 'u1', content: 'alpha bot thoughts?' },
        ],
        AGENT,
        'Alpha Bot'
      )
    ).toBe(true);
  });

  test('blank display name never matches', () => {
    expect(
      hasUnansweredMention([{ senderId: 'u1', content: 'hi' }], AGENT, '  ')
    ).toBe(false);
  });
});
