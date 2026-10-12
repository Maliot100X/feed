import type { ReportEvaluationResult } from '@feed/api';
import { z } from 'zod';

/**
 * Schema for an AI evaluation stored (as JSON) in Report.resolution by
 * storeEvaluationResult. Human-written resolutions share the same column, so
 * parsing must never throw on arbitrary prose (including text starting with
 * "{" or "[").
 */
const StoredEvaluationSchema = z.object({
  outcome: z.enum([
    'valid_report',
    'invalid_report',
    'abusive_reporter',
    'insufficient_evidence',
  ]),
  confidence: z.number(),
  reasoning: z.string(),
  recommendedActions: z.array(z.string()),
  evidenceSummary: z.object({
    chatMessages: z.number(),
    posts: z.number(),
    reportsReceived: z.number(),
    reportsSent: z.number(),
  }),
});

/** Returns the stored AI evaluation, or null when resolution is not one. */
export function parseStoredEvaluation(
  resolution: string | null
): ReportEvaluationResult | null {
  if (!resolution) return null;
  const trimmed = resolution.trim();
  if (!trimmed.startsWith('{')) return null;

  let json: ReturnType<typeof JSON.parse>;
  try {
    json = JSON.parse(trimmed);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const parsed = StoredEvaluationSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
