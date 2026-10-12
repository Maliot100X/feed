import { describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

const secret = new TextEncoder().encode('isolated-test-session-cookie-secret');
function signedToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString(
    'base64url'
  );
  const body = Buffer.from(
    JSON.stringify({
      userId: 'new-user',
      iss: 'steward',
      exp: Math.floor(Date.now() / 1000) + 300,
    })
  ).toString('base64url');
  const data = `${header}.${body}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
const values = new Map<string, string>();
mock.module('next/headers', () => ({
  cookies: async () => ({
    set: (name: string, value: string) => {
      values.set(name, value);
    },
    delete: (name: string) => {
      values.delete(name);
    },
  }),
}));
mock.module('@feed/api', () => ({
  withErrorHandling: (handler: (request: NextRequest) => Promise<Response>) =>
    handler,
}));
mock.module('@/lib/auth/steward-server', () => ({
  getStewardJwtSecret: () => secret,
}));
const { POST } = await import(
  '../../../apps/web/src/app/api/auth/session/route'
);

describe('session cookie bridge', () => {
  test('new login without refresh token clears the previous refresh cookie', async () => {
    values.set('steward-refresh', 'previous-account-refresh');
    const token = signedToken();
    const response = await POST(
      new NextRequest('https://feed.test/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
    );
    expect(response.status).toBe(200);
    expect(values.get('steward-token')).toBe(token);
    expect(values.has('steward-refresh')).toBe(false);
  });
  test('new refresh token replaces the previous cookie', async () => {
    values.set('steward-refresh', 'previous-account-refresh');
    const token = signedToken();
    const response = await POST(
      new NextRequest('https://feed.test/api/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, refreshToken: 'new-refresh' }),
      })
    );
    expect(response.status).toBe(200);
    expect(values.get('steward-refresh')).toBe('new-refresh');
  });
});
