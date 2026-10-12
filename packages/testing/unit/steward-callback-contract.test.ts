import { describe, expect, test } from 'bun:test';
import {
  stewardCallbackParams,
  stewardExchangeSchema,
} from '../../../apps/web/src/lib/auth/steward-exchange';

describe('Steward callback contract', () => {
  test('reads nonce codes from fragments and legacy query codes', () => {
    expect(
      stewardCallbackParams(
        new URL(
          'https://feed.fun/auth/callback/google#code=one-time&state=bound'
        )
      )
    ).toEqual({ code: 'one-time', state: 'bound', error: undefined });
    expect(
      stewardCallbackParams(
        new URL('https://feed.fun/auth/callback/google?code=query&state=bound')
      )
    ).toEqual({ code: 'query', state: 'bound', error: undefined });
  });
  test('does not interpret a token in a URL as a successful code exchange', () => {
    expect(
      stewardCallbackParams(
        new URL(
          'https://feed.fun/auth/callback/google?token=jwt&refreshToken=refresh'
        )
      ).code
    ).toBeUndefined();
    expect(stewardExchangeSchema.safeParse({ ok: true }).success).toBe(false);
    expect(stewardExchangeSchema.safeParse({ token: '' }).success).toBe(false);
  });
  test('keeps an MFA challenge distinct from an authenticated session', () => {
    const result = stewardExchangeSchema.parse({
      ok: true,
      mfaRequired: true,
      mfa: {
        type: 'totp',
        challengeId: 'challenge',
        expiresAt: '2026-10-11T00:00:00Z',
      },
    });
    expect('token' in result).toBe(false);
    expect('mfaRequired' in result).toBe(true);
    expect(
      stewardExchangeSchema.safeParse({ token: 'partial', mfaRequired: true })
        .success
    ).toBe(false);
  });
});
