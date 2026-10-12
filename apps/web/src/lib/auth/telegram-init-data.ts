/**
 * Telegram Mini App initData verification.
 *
 * Implements the algorithm from
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * with the checks every identity-minting caller needs:
 * - exact 64-char hex hash compared in constant time
 * - duplicate keys rejected (URLSearchParams would otherwise hide them)
 * - auth_date required, strictly integer, not older than `maxAgeSeconds`
 *   and not further in the future than `maxFutureSkewSeconds`
 * - signed `user` payload validated (positive safe-integer id)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Maximum accepted initData size (Telegram launch data is a few KB). */
const MAX_INIT_DATA_LENGTH = 8192;
const DEFAULT_MAX_FUTURE_SKEW_SECONDS = 60;

const TelegramUserSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string().min(1).max(256),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().max(2048).optional(),
  language_code: z.string().max(35).optional(),
  is_premium: z.boolean().optional(),
});

export type TelegramInitDataUser = z.infer<typeof TelegramUserSchema>;

export interface VerifiedTelegramInitData {
  user: TelegramInitDataUser;
  authDate: number;
  queryId?: string;
  chatType?: string;
  chatInstance?: string;
}

export type TelegramInitDataResult =
  | { valid: true; data: VerifiedTelegramInitData }
  | { valid: false; reason: string };

export interface VerifyTelegramInitDataOptions {
  /** Maximum age of auth_date in seconds. */
  maxAgeSeconds: number;
  /** Allowed clock skew for auth_date in the future, in seconds. */
  maxFutureSkewSeconds?: number;
  /** Current time in ms (injectable for tests). */
  nowMs?: number;
}

export function verifyTelegramInitData(
  initDataRaw: string,
  botToken: string,
  options: VerifyTelegramInitDataOptions
): TelegramInitDataResult {
  if (initDataRaw.length === 0 || initDataRaw.length > MAX_INIT_DATA_LENGTH) {
    return { valid: false, reason: 'invalid initData length' };
  }

  const params = new URLSearchParams(initDataRaw);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) {
      return { valid: false, reason: 'duplicate parameter' };
    }
    seen.add(key);
  }

  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return { valid: false, reason: 'missing or malformed hash' };
  }
  params.delete('hash');

  // Keys are unique (checked above), so sorting by key is a total order.
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computed = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();

  if (!timingSafeEqual(Buffer.from(hash, 'hex'), computed)) {
    return { valid: false, reason: 'hash verification failed' };
  }

  const authDateStr = params.get('auth_date');
  if (!authDateStr || !/^\d{1,12}$/.test(authDateStr)) {
    return { valid: false, reason: 'missing or invalid auth_date' };
  }
  const authDate = Number(authDateStr);
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const maxFutureSkew =
    options.maxFutureSkewSeconds ?? DEFAULT_MAX_FUTURE_SKEW_SECONDS;
  if (authDate - nowSeconds > maxFutureSkew) {
    return { valid: false, reason: 'auth_date in the future' };
  }
  if (nowSeconds - authDate > options.maxAgeSeconds) {
    return { valid: false, reason: 'auth_date expired' };
  }

  const userStr = params.get('user');
  if (!userStr) {
    return { valid: false, reason: 'missing user data' };
  }
  let userJson: unknown;
  try {
    userJson = JSON.parse(userStr);
  } catch {
    return { valid: false, reason: 'malformed user JSON' };
  }
  const user = TelegramUserSchema.safeParse(userJson);
  if (!user.success) {
    return { valid: false, reason: 'invalid user data' };
  }

  return {
    valid: true,
    data: {
      user: user.data,
      authDate,
      queryId: params.get('query_id') ?? undefined,
      chatType: params.get('chat_type') ?? undefined,
      chatInstance: params.get('chat_instance') ?? undefined,
    },
  };
}
