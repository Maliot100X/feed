/**
 * Telegram mini-app authentication via HMAC-verified initData.
 *
 * Validates Telegram's initData string using HMAC-SHA256 as specified by:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * On success, looks up or creates the Feed user, ensures a Steward user
 * record exists, and returns a Steward-compatible JWT.
 *
 * Client flow:
 *   1. window.Telegram.WebApp.initData is available inside a Telegram mini-app
 *   2. Client POSTs { initData } here
 *   3. This route verifies HMAC + provisions + returns { token }
 *   4. Client POSTs to /api/auth/session to set httpOnly cookie
 */

import { withErrorHandling } from '@feed/api';
import { db, eq, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';
import { SignJWT } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ensureStewardUser,
  getStewardJwtSecret,
} from '@/lib/auth/steward-server';
import { verifyTelegramInitData } from '@/lib/auth/telegram-init-data';

/**
 * Maximum age of signed launch data accepted for minting a session token.
 * Launch data is re-issued every time the Mini App opens; stale data must
 * not be replayable indefinitely.
 */
const MAX_INIT_DATA_AGE_SECONDS = 60 * 60;

const RequestSchema = z.object({
  initData: z.string().min(1),
});

async function mintToken(
  stewardUserId: string,
  telegramId: string
): Promise<string> {
  return new SignJWT({ userId: stewardUserId, tenantId: 'feed', telegramId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('steward')
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getStewardJwtSecret());
}

export const POST = withErrorHandling(async (req: NextRequest) => {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'Telegram authentication not configured' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'initData is required' },
      { status: 400 }
    );
  }

  const verification = verifyTelegramInitData(parsed.data.initData, BOT_TOKEN, {
    maxAgeSeconds: MAX_INIT_DATA_AGE_SECONDS,
  });
  if (!verification.valid) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Telegram initData' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const telegramUser = verification.data.user;
  const telegramId = String(telegramUser.id);

  // Look up Feed user by Telegram ID
  const [existing] = await db
    .select({ id: users.id, stewardId: users.stewardId, email: users.email })
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  let stewardUserId: string;

  if (existing) {
    if (existing.stewardId) {
      stewardUserId = existing.stewardId;
    } else {
      stewardUserId = await ensureStewardUser(existing.email ?? undefined);
    }
    // Always refresh mutable Telegram fields (username can change)
    await db
      .update(users)
      .set({
        stewardId: stewardUserId,
        telegramUsername: telegramUser.username ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
  } else {
    stewardUserId = await ensureStewardUser();
    const newId = await generateSnowflakeId();
    await db.insert(users).values({
      id: newId,
      stewardId: stewardUserId,
      telegramId,
      telegramUsername: telegramUser.username ?? null,
      displayName: telegramUser.first_name ?? null,
      isActor: false,
      updatedAt: new Date(),
    });
  }

  const token = await mintToken(stewardUserId, telegramId);
  return NextResponse.json(
    { ok: true, token },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
