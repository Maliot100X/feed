/**
 * Pure helpers for verifying that an X/Twitter post shares the expected link.
 */

const SUPPORTED_TWITTER_HOSTS = new Set([
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'x.com',
  'www.x.com',
  'mobile.x.com',
]);

export interface ParsedTwitterPostUrl {
  tweetId: string;
  tweetUsername: string | null;
}

export function normalizeUsername(username: string): string {
  return username.toLowerCase().replace(/^@/, '');
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/**
 * True when `candidate` points at the same resource as the shared `expected`
 * URL: same host (ignoring a leading www.), same path (ignoring a trailing
 * slash, case-sensitive) and every query parameter of the expected URL present
 * with the same value. Extra tracking parameters and fragments are ignored.
 * Prefix domains (feed.fun.evil.com) and prefix paths never match.
 */
export function sharedUrlMatches(expected: string, candidate: string): boolean {
  let expectedUrl: URL;
  let candidateUrl: URL;
  try {
    expectedUrl = new URL(expected);
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(candidateUrl.protocol)) return false;
  if (
    normalizeHost(expectedUrl.hostname) !== normalizeHost(candidateUrl.hostname)
  ) {
    return false;
  }
  if (
    normalizePath(expectedUrl.pathname) !== normalizePath(candidateUrl.pathname)
  ) {
    return false;
  }
  for (const [key, value] of expectedUrl.searchParams) {
    if (candidateUrl.searchParams.get(key) !== value) return false;
  }
  return true;
}

export const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"]+/g;

export function parseTwitterPostUrl(
  postUrl: string
): ParsedTwitterPostUrl | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(postUrl);
  } catch {
    return null;
  }

  if (!SUPPORTED_TWITTER_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    return null;
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  const isTweetId = (value: string | undefined): value is string =>
    !!value && /^\d{1,25}$/.test(value);

  // Mobile/app links: /i/web/status/:tweetId and /i/status/:tweetId.
  // Checked before the generic branch so "i" is never read as a username.
  if (segments[0] === 'i') {
    if (segments[1] === 'web' && segments[2] === 'status') {
      return isTweetId(segments[3])
        ? { tweetId: segments[3], tweetUsername: null }
        : null;
    }
    if (segments[1] === 'status') {
      return isTweetId(segments[2])
        ? { tweetId: segments[2], tweetUsername: null }
        : null;
    }
    return null;
  }

  // Common copy-link format: /username/status/:tweetId
  if (segments[1] === 'status' && isTweetId(segments[2])) {
    return {
      tweetId: segments[2],
      tweetUsername: segments[0] ?? null,
    };
  }

  return null;
}
