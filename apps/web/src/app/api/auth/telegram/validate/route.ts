/**
 * Telegram Mini App initData Validation API
 *
 * @route POST /api/auth/telegram/validate - Validate Telegram Mini App initData
 * @access Public (called from the Telegram Mini App iframe)
 *
 * @description
 * Validates the authenticity of Telegram Mini App launch data (`initData`)
 * using HMAC-SHA-256 with the bot token, following Telegram's official
 * validation algorithm.
 *
 * This prevents spoofing attacks where a malicious client could forge
 * `initData` with arbitrary user IDs.
 *
 * Algorithm (from Telegram docs):
 * 1. Parse `initData` as URL-encoded params
 * 2. Extract `hash` param, remove it from the data
 * 3. Sort remaining params alphabetically by key
 * 4. Join as `key=value` pairs with `\n`
 * 5. Compute secret_key = HMAC-SHA-256("WebAppData", bot_token)
 * 6. Compute data_hash  = HMAC-SHA-256(secret_key, data_check_string)
 * 7. Compare data_hash with the extracted hash (hex-encoded)
 *
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

import { withErrorHandling } from '@feed/api';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyTelegramInitData } from '@/lib/auth/telegram-init-data';

/** Maximum age of initData before it's considered stale (5 minutes). */
const MAX_AUTH_AGE_SECONDS = 300;

const RequestSchema = z.object({
  initData: z.string().min(1, 'initData is required'),
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    // If the bot token isn't configured, we can't validate initData.
    // Log a warning and return a clear error — this is a deployment
    // configuration issue, not a runtime error.
    logger.warn(
      'Telegram initData validation skipped: TELEGRAM_BOT_TOKEN not configured',
      {},
      'TelegramMiniApp'
    );
    return NextResponse.json(
      { error: 'Telegram validation not configured' },
      { status: 501 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Missing or invalid initData' },
      { status: 400 }
    );
  }

  const { initData } = parsed.data;

  const result = verifyTelegramInitData(initData, botToken, {
    maxAgeSeconds: MAX_AUTH_AGE_SECONDS,
  });

  if (!result.valid) {
    logger.warn(
      'Telegram initData validation failed',
      { reason: result.reason },
      'TelegramMiniApp'
    );
    return NextResponse.json(
      { error: 'Invalid initData', reason: result.reason },
      { status: 403 }
    );
  }

  logger.info(
    'Telegram initData validated successfully',
    { userId: result.data.user.id, username: result.data.user.username },
    'TelegramMiniApp'
  );

  return NextResponse.json({
    valid: true,
    user: result.data.user,
    authDate: result.data.authDate,
  });
});
