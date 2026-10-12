import { describe, expect, test } from 'bun:test';
import { safeReturnTo } from '../../../apps/web/src/lib/auth/safe-return-to';

describe('OAuth return destination', () => {
  test('keeps same-origin paths and encoded query values', () => {
    expect(safeReturnTo('/profile?label=a%2Fb#posts')).toBe(
      '/profile?label=a%2Fb#posts'
    );
    const params = new URLSearchParams('returnTo=%2Fsearch%3Fq%3D%252F');
    expect(safeReturnTo(params.get('returnTo'))).toBe('/search?q=%2F');
  });

  test('rejects external destinations and browser URL normalization tricks', () => {
    for (const value of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\n/evil.example',
      '/\t/evil.example',
    ]) {
      expect(safeReturnTo(value)).toBe('/');
    }
  });
});

describe('safeReturnTo fallback', () => {
  test('uses the provided fallback for unsafe values', () => {
    expect(safeReturnTo('//evil.example', '/feed')).toBe('/feed');
    expect(safeReturnTo('/\\evil.example', '/feed')).toBe('/feed');
    expect(safeReturnTo(null, '/feed')).toBe('/feed');
    expect(safeReturnTo('/markets/1', '/feed')).toBe('/markets/1');
  });
});
