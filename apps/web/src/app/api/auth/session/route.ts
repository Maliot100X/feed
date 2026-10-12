/**
 * Cookie bridge for Steward JWTs.
 *
 * POST  — Verifies a Steward JWT and sets it as an httpOnly steward-token cookie.
 *         Called by auth callback pages after receiving a token from Steward.
 *         Tokens are always sent in the POST body, never in URL params.
 * DELETE — Clears steward-token and steward-refresh cookies (logout).
 */

import { withErrorHandling } from '@feed/api';
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStewardJwtSecret } from '@/lib/auth/steward-server';

const SessionBodySchema = z.object({
  token: z.string().min(1).max(8192),
  refreshToken: z.string().max(8192).nullish(),
});

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export const POST = withErrorHandling(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const parsed = SessionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }
  const { token, refreshToken } = parsed.data;

  // Verify the JWT locally before storing — rejects tampered or expired tokens
  // Resolve the secret outside the verification try/catch so a server
  // misconfiguration surfaces as a 500 rather than an invalid-token 401.
  const secret = getStewardJwtSecret();
  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'steward',
      algorithms: ['HS256'],
    });
    const claim = payload['userId'];
    if (typeof claim !== 'string' || claim.length === 0) {
      throw new Error('missing userId claim');
    }
    userId = claim;
  } catch {
    return NextResponse.json(
      { error: 'Invalid Steward token' },
      { status: 401 }
    );
  }

  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === 'production';

  cookieStore.set('steward-token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: THIRTY_DAYS,
    path: '/',
  });

  if (refreshToken) {
    cookieStore.set('steward-refresh', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: THIRTY_DAYS,
      path: '/',
    });
  } else {
    cookieStore.delete('steward-refresh');
  }

  return NextResponse.json({ ok: true, userId });
});

export const DELETE = withErrorHandling(async () => {
  const cookieStore = await cookies();
  cookieStore.delete('steward-token');
  cookieStore.delete('steward-refresh');
  return NextResponse.json({ ok: true });
});
