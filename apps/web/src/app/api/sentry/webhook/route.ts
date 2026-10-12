import { ingestSentryWebhook, withErrorHandling } from '@feed/api';
import { logger } from '@feed/shared';
import { NextResponse } from 'next/server';

const DEFAULT_MAX_TIMESTAMP_SKEW_SECONDS = 300;
const MIN_TIMESTAMP_SKEW_SECONDS = 30;
const MAX_TIMESTAMP_SKEW_SECONDS = 3600;

export const dynamic = 'force-dynamic';

function parseMaxTimestampSkewSeconds(): number {
  const rawValue = process.env.SENTRY_WEBHOOK_MAX_TIMESTAMP_SKEW_SECONDS;
  if (!rawValue) {
    return DEFAULT_MAX_TIMESTAMP_SKEW_SECONDS;
  }

  // Strict: reject suffixes/fractions and out-of-range values instead of
  // silently truncating or clamping a misconfiguration.
  const parsed = /^\d+$/.test(rawValue.trim()) ? Number(rawValue.trim()) : NaN;
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TIMESTAMP_SKEW_SECONDS ||
    parsed > MAX_TIMESTAMP_SKEW_SECONDS
  ) {
    throw new Error(
      `SENTRY_WEBHOOK_MAX_TIMESTAMP_SKEW_SECONDS must be an integer between ${MIN_TIMESTAMP_SKEW_SECONDS} and ${MAX_TIMESTAMP_SKEW_SECONDS}`
    );
  }
  return parsed;
}

export const POST = withErrorHandling(async function POST(request: Request) {
  const webhookSecret = process.env.SENTRY_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    logger.error(
      'Sentry webhook secret is missing. Rejecting webhook ingestion.',
      {},
      'SentryWebhook'
    );
    return NextResponse.json(
      {
        error:
          'Sentry webhook endpoint is not configured. Set SENTRY_WEBHOOK_SECRET.',
        code: 'WEBHOOK_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const result = await ingestSentryWebhook({
    rawBody,
    secret: webhookSecret,
    maxTimestampSkewSeconds: parseMaxTimestampSkewSeconds(),
    headers: {
      signature: request.headers.get('sentry-hook-signature'),
      timestamp: request.headers.get('sentry-hook-timestamp'),
      resource: request.headers.get('sentry-hook-resource'),
      event: request.headers.get('sentry-hook-event'),
      requestId: request.headers.get('x-request-id'),
      userAgent: request.headers.get('user-agent'),
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.httpStatus }
    );
  }

  return NextResponse.json({
    received: true,
    enqueued: result.enqueued,
    inboxId: result.inboxId ?? null,
    dedupeKey: result.dedupeKey,
    resource: result.resource,
    action: result.action,
    projectSlug: result.projectSlug,
    issueId: result.issueId,
    eventId: result.eventId,
  });
});
