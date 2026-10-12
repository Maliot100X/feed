/**
 * OAuth account-link callbacks must atomically consume the stored state
 * before contacting the provider, so a replayed/concurrent callback cannot
 * exchange the same authorization twice.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const actualDb = await import('@feed/db');

const findFirst = mock();
const deleteState = mock();

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    oAuthState: { findFirst, delete: deleteState },
  },
}));

const { GET: discordCallback } = await import('../discord/callback/route');
const { GET: twitterCallback } = await import('../twitter/callback/route');

const originalFetch = globalThis.fetch;
const fetchMock = mock();

function callbackRequest(provider: 'discord' | 'twitter') {
  const state = `user-1|${Date.now()}|${crypto.randomUUID()}`;
  return new NextRequest(
    `http://localhost/api/auth/${provider}/callback?code=abc&state=${encodeURIComponent(state)}`
  );
}

describe('OAuth callback state claim', () => {
  beforeEach(() => {
    findFirst.mockReset();
    deleteState.mockReset();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    findFirst.mockResolvedValue({
      id: 'state-1',
      userId: 'user-1',
      codeVerifier: 'verifier',
    });
    // Another callback already consumed the state: delete returns nothing.
    deleteState.mockResolvedValue(undefined);
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  for (const [provider, handler] of [
    ['discord', discordCallback],
    ['twitter', twitterCallback],
  ] as const) {
    it(`${provider}: does not exchange the code when the state was already consumed`, async () => {
      const response = (await handler(
        callbackRequest(provider) as never
      )) as Response;

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('error=invalid_state');
      expect(deleteState).toHaveBeenCalledWith({ where: { id: 'state-1' } });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});
