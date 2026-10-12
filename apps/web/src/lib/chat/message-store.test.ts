import { describe, expect, it } from 'bun:test';
import type { ChatMessage } from '@/hooks/useChatMessages';
import { trimForCache } from './message-store';

const messages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `m${i}` }) as ChatMessage);

describe('trimForCache', () => {
  it('keeps small histories and their pagination as-is', () => {
    const data = { messages: messages(3), hasMore: false, nextCursor: null };
    expect(trimForCache(data)).toEqual(data);
  });

  it('resumes pagination from the oldest retained message when truncating', () => {
    const out = trimForCache({
      messages: messages(150),
      hasMore: false,
      nextCursor: null,
    });
    expect(out.messages).toHaveLength(100);
    expect(out.messages[0]?.id).toBe('m50');
    expect(out.hasMore).toBe(true);
    expect(out.nextCursor).toBe('m50');
  });
});
