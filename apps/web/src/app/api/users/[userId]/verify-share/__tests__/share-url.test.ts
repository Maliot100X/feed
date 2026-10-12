import { describe, expect, test } from 'bun:test';
import { parseTwitterPostUrl, sharedUrlMatches } from '../share-url';

describe('parseTwitterPostUrl', () => {
  test('parses the username/status copy-link format', () => {
    expect(parseTwitterPostUrl('https://x.com/alice/status/12345')).toEqual({
      tweetId: '12345',
      tweetUsername: 'alice',
    });
  });

  test('does not treat /i/status links as username "i"', () => {
    expect(parseTwitterPostUrl('https://x.com/i/status/12345')).toEqual({
      tweetId: '12345',
      tweetUsername: null,
    });
    expect(
      parseTwitterPostUrl('https://twitter.com/i/web/status/98765?s=20')
    ).toEqual({ tweetId: '98765', tweetUsername: null });
  });

  test('rejects unsupported hosts and malformed IDs', () => {
    expect(parseTwitterPostUrl('https://evil.com/alice/status/1')).toBeNull();
    expect(parseTwitterPostUrl('https://x.com/alice/status/abc')).toBeNull();
    expect(parseTwitterPostUrl('https://x.com/i/status/')).toBeNull();
    expect(parseTwitterPostUrl('not a url')).toBeNull();
  });
});

describe('sharedUrlMatches', () => {
  const expected = 'https://feed.fun/post/123?ref=alice';

  test('matches the same resource with extra tracking params and fragments', () => {
    expect(
      sharedUrlMatches(
        expected,
        'https://www.feed.fun/post/123/?ref=alice&utm=x#c'
      )
    ).toBe(true);
  });

  test('rejects prefix domains and prefix/suffix paths', () => {
    expect(
      sharedUrlMatches(expected, 'https://feed.fun.evil.com/post/123?ref=alice')
    ).toBe(false);
    expect(
      sharedUrlMatches(expected, 'https://feed.fun/post/1234?ref=alice')
    ).toBe(false);
    expect(sharedUrlMatches(expected, 'https://feed.fun/post?ref=alice')).toBe(
      false
    );
  });

  test('requires expected query params and is case-sensitive on paths', () => {
    expect(sharedUrlMatches(expected, 'https://feed.fun/post/123')).toBe(false);
    expect(
      sharedUrlMatches('https://feed.fun/u/Alice', 'https://feed.fun/u/alice')
    ).toBe(false);
  });

  test('rejects non-http candidates and unparseable input', () => {
    expect(sharedUrlMatches(expected, 'javascript:alert(1)')).toBe(false);
    expect(sharedUrlMatches(expected, 'feed.fun/post/123')).toBe(false);
  });
});
