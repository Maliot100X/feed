import { logger } from '@feed/shared';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { streamAdd } from '../redis';
import type { JsonValue } from '../types';

/**
 * Realtime channel name. Known channels: 'feed', 'markets', 'breaking-news',
 * 'upcoming-events', `chat:<id>`, `notifications:<userId>`, `agent:<id>`.
 * Typed as a plain string because channels are also built dynamically.
 */
export type RealtimeChannel = string;

export interface RealtimeEventEnvelope<T extends JsonValue = JsonValue> {
  channel: RealtimeChannel;
  type: string;
  version?: string;
  data: T;
  timestamp: number;
}

export interface RealtimeTokenPayload {
  userId: string;
  channels: RealtimeChannel[];
  exp: number; // epoch seconds
  iat: number; // epoch seconds
}

const base64url = (input: Buffer) =>
  input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const decodeBase64url = (input: string) => {
  const padding = 4 - (input.length % 4 || 4);
  const normalized =
    input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding % 4);
  return Buffer.from(normalized, 'base64');
};

const getSecret = (): Buffer => {
  const secret =
    process.env.REALTIME_SIGNING_SECRET ||
    process.env.JWT_SECRET ||
    process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('REALTIME_SIGNING_SECRET is not configured');
  }
  return Buffer.from(secret);
};

/**
 * Sign a realtime subscription payload (HMAC-SHA256).
 */
export function signRealtimeToken(payload: RealtimeTokenPayload): string {
  const header = { alg: 'HS256', typ: 'JWT', kid: 'realtime' };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sig = createHmac('sha256', getSecret()).update(signingInput).digest();
  return `${signingInput}.${base64url(sig)}`;
}

/**
 * Verify a realtime subscription token and return the payload if valid.
 */
export function verifyRealtimeToken(
  token: string
): RealtimeTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  if (!h || !p || !s) return null;
  const signingInput = `${h}.${p}`;
  const expected = createHmac('sha256', getSecret())
    .update(signingInput)
    .digest();
  const actual = decodeBase64url(s);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  // The signing secret may be shared with other HS256 tokens (JWT_SECRET),
  // so require the realtime header to prevent cross-token confusion.
  const header = RealtimeTokenHeaderSchema.safeParse(
    safeParseJson(decodeBase64url(h).toString())
  );
  if (!header.success) return null;

  const payload = RealtimeTokenPayloadSchema.safeParse(
    safeParseJson(decodeBase64url(p).toString())
  );
  if (!payload.success) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.data.exp <= now) return null;
  return payload.data;
}

const RealtimeTokenHeaderSchema = z.object({
  alg: z.literal('HS256'),
  typ: z.literal('JWT'),
  kid: z.literal('realtime'),
});

const RealtimeTokenPayloadSchema = z.object({
  userId: z.string().min(1),
  channels: z.array(z.string()),
  exp: z.number().int().finite(),
  iat: z.number().int().finite(),
});

function safeParseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Publish an event to a realtime channel.
 *
 * Delivery is best-effort: if the Redis stream is unavailable the event is
 * logged and dropped (it is NOT enqueued for replay). Callers that need
 * guaranteed delivery must persist with enqueueOutbox, which the
 * realtime-drain cron publishes with retries.
 */
export async function publishEvent(
  event: RealtimeEventEnvelope,
  opts?: { maxlen?: number }
): Promise<void> {
  const streamKey = toStreamKey(event.channel);
  const res = await streamAdd(
    streamKey,
    { ...event, version: event.version ?? 'v1' } as Record<string, JsonValue>,
    {
      maxlen: opts?.maxlen ?? 10_000,
    }
  );
  if (!res) {
    logger.warn(
      'Realtime publish skipped because Redis stream is unavailable',
      { channel: event.channel, type: event.type },
      'Realtime'
    );
    return;
  }
  logger.info(
    'Realtime event published',
    { channel: event.channel, type: event.type, streamId: res },
    'Realtime'
  );
}

export const toStreamKey = (channel: RealtimeChannel) => `realtime:${channel}`;

/**
 * Generate a short-lived realtime token for a user and channels.
 * Default expiry: 15 minutes.
 */
export function issueRealtimeToken(params: {
  userId: string;
  channels: RealtimeChannel[];
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (params.ttlSeconds ?? 900);
  const payload: RealtimeTokenPayload = {
    userId: params.userId,
    channels: params.channels,
    exp,
    iat: now,
  };
  return signRealtimeToken(payload);
}

export const generateConnectionId = () => randomBytes(12).toString('hex');
