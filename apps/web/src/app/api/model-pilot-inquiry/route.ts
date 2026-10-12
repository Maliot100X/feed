/**
 * Model pilot inquiry — POST from /research. Fully public (no Privy/session/API key).
 * Rate limited by client IP only. Not linked in navigation (noindex).
 * Emails feed@elizalabs.ai (overridable) and the submitter via SendGrid.
 */

import {
  checkRateLimitAsync,
  getClientIp,
  RATE_LIMIT_CONFIGS,
  rateLimitError,
  sendModelPilotInquiryEmails,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import {
  MODEL_PILOT_DELIVERABLES,
  MODEL_PILOT_OUTPUTS,
  MODEL_PILOT_REVIEW_LEVELS,
  MODEL_PILOT_SCENARIOS,
} from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

const DeliverableSchema = z.enum(MODEL_PILOT_DELIVERABLES);
const ScenarioSchema = z.enum(MODEL_PILOT_SCENARIOS);
const OutputSchema = z.enum(MODEL_PILOT_OUTPUTS);
const ReviewSchema = z.enum(MODEL_PILOT_REVIEW_LEVELS);

/** Bounded to the available choices; duplicates are rejected. */
function uniqueChoices<T extends string>(
  schema: z.ZodType<T>,
  choices: readonly T[]
) {
  return z
    .array(schema)
    .max(choices.length)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Duplicate choices',
    });
}

const BodySchema = z.object({
  email: z.string().trim().email(),
  agreedToTerms: z.literal(true),
  modelProvider: z.string().trim().max(500),
  modelName: z.string().trim().max(500),
  apiEndpoint: z.string().trim().max(2000),
  toolUse: z.boolean(),
  memory: z.boolean(),
  deliverables: uniqueChoices(DeliverableSchema, MODEL_PILOT_DELIVERABLES).min(
    1
  ),
  scenarios: uniqueChoices(ScenarioSchema, MODEL_PILOT_SCENARIOS).min(1),
  outputs: uniqueChoices(OutputSchema, MODEL_PILOT_OUTPUTS),
  concurrentAgents: z.number().int().min(10).max(5000),
  scenarioRuns: z.number().int().min(100).max(100_000),
  humanReview: ReviewSchema,
  privateDeployment: z.boolean(),
  dataExclusivity: z.boolean(),
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ipKey = getClientIp(request.headers) ?? 'anonymous';
  const limit = await checkRateLimitAsync(
    ipKey,
    RATE_LIMIT_CONFIGS.MODEL_PILOT_INQUIRY
  );
  if (!limit.allowed) {
    return rateLimitError(limit.retryAfter);
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'invalid_request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    email,
    modelProvider,
    modelName,
    apiEndpoint,
    toolUse,
    memory,
    deliverables,
    scenarios,
    outputs,
    concurrentAgents,
    scenarioRuns,
    humanReview,
    privateDeployment,
    dataExclusivity,
  } = parsed.data;

  const result = await sendModelPilotInquiryEmails({
    senderEmail: email,
    modelProvider,
    modelName,
    apiEndpoint,
    toolUse,
    memory,
    deliverables,
    scenarios,
    outputs,
    concurrentAgents,
    scenarioRuns,
    humanReview,
    privateDeployment,
    dataExclusivity,
  });

  if (!result.sent) {
    const status = result.reason === 'provider_not_configured' ? 503 : 502;
    return new Response(
      JSON.stringify({
        error: 'email_delivery_failed',
        reason: result.reason ?? 'unknown',
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const res = successResponse({ ok: true });
  if (limit.remaining !== undefined) {
    res.headers.set(
      'X-RateLimit-Remaining',
      Math.max(0, limit.remaining).toString()
    );
  }
  return res;
});
