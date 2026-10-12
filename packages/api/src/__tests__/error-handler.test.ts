import { describe, expect, it } from 'bun:test';
import { NextRequest } from 'next/server';
import { errorHandler, sanitizeUrlForLogging } from '../error-handler';
import { RateLimitError } from '../errors';

describe('errorHandler', () => {
  it('sets Retry-After from RateLimitError', () => {
    const response = errorHandler(
      new RateLimitError('Slow down', 30),
      new NextRequest('http://localhost/api/x')
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('returns 500 for plain errors', async () => {
    const response = errorHandler(
      new Error('boom'),
      new NextRequest('http://localhost/api/x')
    );
    expect(response.status).toBe(500);
  });
});

describe('sanitizeUrlForLogging', () => {
  it('redacts credential-like query parameters', () => {
    const url = sanitizeUrlForLogging(
      'https://feed.test/api/sse/events?token=abc.def.ghi&channel=feed&api_key=k'
    );
    expect(url).not.toContain('abc.def.ghi');
    expect(url).not.toContain('api_key=k');
    expect(url).toContain('channel=feed');
  });
});
