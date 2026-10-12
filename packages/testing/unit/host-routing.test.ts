import { describe, expect, it } from 'bun:test';
import {
  getLegacyCanonicalOrigin,
  isLegacyCanonicalHostname,
} from '../../../apps/web/src/lib/host-routing';

describe('host-routing (canonical redirects)', () => {
  it('identifies only the www alias for redirecting', () => {
    expect(isLegacyCanonicalHostname('www.feed.fun')).toBe(true);
    expect(isLegacyCanonicalHostname(' WWW.FEED.FUN ')).toBe(true);
    expect(isLegacyCanonicalHostname('feed.fun')).toBe(false);
  });
  it('maps the www alias to feed.fun', () => {
    expect(getLegacyCanonicalOrigin('www.feed.fun', 'https:')).toBe(
      'https://feed.fun'
    );
  });
  it('never redirects the canonical host to itself', () => {
    expect(getLegacyCanonicalOrigin('feed.fun', 'https:')).toBeNull();
    expect(getLegacyCanonicalOrigin('staging.feed.fun', 'https:')).toBeNull();
    expect(getLegacyCanonicalOrigin('localhost', 'http:')).toBeNull();
  });
});
