/**
 * auth-middleware error classification: credential problems are 401s,
 * configuration and infrastructure problems are not disguised as 401s.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { createAgentSession, setSessionStore } from '../agent-auth';
import { authenticate, optionalAuth } from '../auth-middleware';
import { AuthenticationError, ServiceUnavailableError } from '../errors';

const SECRET = 'unit-test-steward-secret';
const touchedEnv = ['NODE_ENV', 'STEWARD_JWT_SECRET'] as const;
const savedEnv: Partial<Record<(typeof touchedEnv)[number], string>> = {};

function bearer(token: string): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function signStewardJwt(
  claims: Record<string, unknown>,
  expiresIn: string | number = '5m'
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('steward')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET));
}

describe('auth-middleware error classification', () => {
  beforeEach(() => {
    for (const key of touchedEnv) savedEnv[key] = process.env[key];
    setSessionStore(null);
  });

  afterEach(() => {
    for (const key of touchedEnv) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    setSessionStore(null);
  });

  it('reports a missing production secret as service unavailable, not 401', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STEWARD_JWT_SECRET;
    const token = await signStewardJwt({ userId: 'steward-user' });

    const error = await authenticate(bearer(token)).catch((e: Error) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).not.toBeInstanceOf(AuthenticationError);
  });

  it('maps a malformed token to AuthenticationError', async () => {
    process.env.STEWARD_JWT_SECRET = SECRET;
    const error = await authenticate(bearer('a.b.c')).catch((e: Error) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as Error).message).toContain('Invalid authentication token');
  });

  it('maps an expired token to the expired message', async () => {
    process.env.STEWARD_JWT_SECRET = SECRET;
    const token = await signStewardJwt(
      { userId: 'steward-user' },
      Math.floor(Date.now() / 1000) - 60
    );
    const error = await authenticate(bearer(token)).catch((e: Error) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as Error).message).toContain('expired');
  });

  it('maps a token signed with the wrong secret to AuthenticationError', async () => {
    process.env.STEWARD_JWT_SECRET = 'a-different-secret';
    const token = await signStewardJwt({ userId: 'steward-user' });
    const error = await authenticate(bearer(token)).catch((e: Error) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it('surfaces agent session store failures instead of a 401', async () => {
    process.env.STEWARD_JWT_SECRET = SECRET;
    setSessionStore({
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => undefined,
      delete: async () => undefined,
    });
    const opaqueToken = 'f'.repeat(64);
    const error = await authenticate(bearer(opaqueToken)).catch(
      (e: Error) => e
    );
    expect(error).toBeInstanceOf(ServiceUnavailableError);
  });

  it('does not consult the agent session store for JWT-shaped tokens', async () => {
    process.env.STEWARD_JWT_SECRET = SECRET;
    let storeCalls = 0;
    setSessionStore({
      get: async () => {
        storeCalls++;
        throw new Error('redis down');
      },
      set: async () => undefined,
      delete: async () => undefined,
    });
    const error = await authenticate(bearer('a.b.c')).catch((e: Error) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(storeCalls).toBe(0);
  });

  it('authenticates a valid agent session token', async () => {
    const opaqueToken = 'e'.repeat(64);
    await createAgentSession('agent-123', opaqueToken);
    const user = await authenticate(bearer(opaqueToken));
    expect(user).toMatchObject({ userId: 'agent-123', isAgent: true });
  });

  it('optionalAuth returns null for invalid credentials but propagates config errors', async () => {
    process.env.STEWARD_JWT_SECRET = SECRET;
    expect(await optionalAuth(bearer('a.b.c'))).toBeNull();

    process.env.NODE_ENV = 'production';
    delete process.env.STEWARD_JWT_SECRET;
    const error = await optionalAuth(bearer('a.b.c')).catch((e: Error) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
  });
});
