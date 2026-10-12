import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { SignJWT } from 'jose';

const SECRET = new TextEncoder().encode('session-test-secret');
const cookieSet = mock();
const cookieDelete = mock();

mock.module('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, delete: cookieDelete }),
}));

mock.module('@/lib/auth/steward-server', () => ({
  getStewardJwtSecret: () => SECRET,
}));

const { POST } = await import('../route');

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

function sign(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('steward')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}

describe('POST /api/auth/session', () => {
  beforeEach(() => {
    cookieSet.mockReset();
    cookieDelete.mockReset();
  });

  it('rejects null and wrongly typed bodies', async () => {
    expect((await post(null)).status).toBe(400);
    expect((await post({ token: 123 })).status).toBe(400);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('rejects tokens whose userId claim is not a string', async () => {
    const response = await post({ token: await sign({ userId: 42 }) });
    expect(response.status).toBe(401);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('clears a previous refresh cookie when no refresh token is supplied', async () => {
    const response = await post({
      token: await sign({ userId: 'user-1' }),
      refreshToken: null,
    });
    expect(response.status).toBe(200);
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(cookieSet.mock.calls[0]?.[0]).toBe('steward-token');
    expect(cookieDelete).toHaveBeenCalledWith('steward-refresh');
  });
});
