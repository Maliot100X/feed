import { describe, expect, it } from 'bun:test';
import { parseTickerParams } from '../params';

describe('parseTickerParams', () => {
  it('returns defaults when no params are given', () => {
    expect(parseTickerParams({})).toEqual({
      streams: 'news,predictions,perps',
      theme: 'dark',
      speed: 0.7,
      height: 48,
    });
  });

  it('clamps numeric params to their ranges', () => {
    const params = parseTickerParams({ speed: '10', height: '5' });
    expect(params.speed).toBe(3);
    expect(params.height).toBe(32);
  });

  it('rejects partial numerics instead of truncating them', () => {
    const params = parseTickerParams({ speed: '2x', height: '80px' });
    expect(params.speed).toBe(0.7);
    expect(params.height).toBe(48);
  });

  it('uses the first value of repeated params and normalizes theme', () => {
    const params = parseTickerParams({
      theme: ['LIGHT', 'dark'],
      streams: '  news ',
    });
    expect(params.theme).toBe('light');
    expect(params.streams).toBe('news');
  });
});
