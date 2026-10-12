import { describe, expect, test } from 'bun:test';
import { parsePostId } from '../../post-id-parser';

describe('parsePostId', () => {
  test('format 1 keeps hyphenated author ids', () => {
    const r = parsePostId(
      'feed-1761441310151-kash-patrol-2025-10-01T02:12:00Z'
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.metadata.gameId).toBe('feed');
    expect(r.metadata.authorId).toBe('kash-patrol');
    expect(r.metadata.timestamp.toISOString()).toBe('2025-10-01T02:12:00.000Z');
  });

  test('post format without author', () => {
    const r = parsePostId('post-1762099655817-0.7781412938928327');
    expect(r.success && r.metadata.authorId).toBe('system');
  });

  test('post format keeps full hyphenated actor id', () => {
    const r = parsePostId('post-1762099655817-kash-patrol-abc123');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.metadata.authorId).toBe('kash-patrol');
    expect(r.metadata.timestamp.getTime()).toBe(1762099655817);
  });

  test('post format rejects garbage timestamp suffix', () => {
    expect(parsePostId('post-1762099655817abc-actor-x').success).toBe(false);
  });

  test('legacy game format with ISO timestamp is not misparsed as format 1', () => {
    const r = parsePostId('game-abc-2025-10-01T02:12:00Z');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.metadata.gameId).toBe('abc');
    expect(r.metadata.authorId).toBe('system');
  });

  test('legacy game format with epoch ms; garbage rejected', () => {
    const ok = parsePostId('game-abc-1762099655817');
    expect(ok.success && ok.metadata.timestamp.getTime()).toBe(1762099655817);
    expect(parsePostId('game-abc-123xyz').success).toBe(false);
  });

  test('unknown ids fail without fabricated metadata', () => {
    const r = parsePostId('1234567890');
    expect(r.success).toBe(false);
    expect(r.metadata).toBeUndefined();
  });
});
