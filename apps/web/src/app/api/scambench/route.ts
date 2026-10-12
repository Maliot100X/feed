/**
 * ScamBench Human Evaluation API
 *
 * @route POST /api/scambench - Submit evaluation results
 * @route GET  /api/scambench - Get aggregate leaderboard
 * @access Public (no auth required for participation)
 */

import { withErrorHandling } from '@feed/api';
import { db } from '@feed/db';
import { scambenchSessions } from '@feed/db/schema';
import { randomUUID } from 'crypto';
import { avg, count, desc } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const MAX_RESPONSES = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const DurationMsSchema = z.number().finite().min(0).max(DAY_MS);
const AccuracySchema = z.number().finite().min(0).max(100);

const ScamBenchResponseSchema = z.object({
  scenarioId: z.string().min(1).max(200),
  scenarioName: z.string().max(500).optional(),
  category: z.string().max(200),
  intent: z.enum(['attack', 'legitimate']),
  difficulty: z.number().finite(),
  register: z.string().max(200),
  channel: z.string().max(200),
  chosenAction: z.string().max(200),
  expectedSafeActions: z.array(z.string().max(200)).max(50),
  correct: z.boolean(),
  explanation: z.string().max(5000),
  readTimeMs: DurationMsSchema,
  responseTimeMs: DurationMsSchema,
  totalTimeMs: DurationMsSchema,
  timestamp: z.string().max(64),
});

const ScamBenchSubmissionSchema = z.object({
  participantId: z.string().trim().min(1).max(128).default('anonymous'),
  scenarioCount: z.number().int().min(1).max(MAX_RESPONSES).optional(),
  overallAccuracy: AccuracySchema.optional(),
  attackAccuracy: AccuracySchema.optional(),
  legitimateAccuracy: AccuracySchema.optional(),
  avgReadTimeMs: DurationMsSchema.optional(),
  avgResponseTimeMs: DurationMsSchema.optional(),
  results: z.array(ScamBenchResponseSchema).min(1).max(MAX_RESPONSES),
});

export const POST = withErrorHandling(async function POST(
  request: NextRequest
) {
  // Malformed JSON -> 400 and schema violations -> 400 via withErrorHandling.
  const {
    participantId,
    scenarioCount,
    overallAccuracy,
    attackAccuracy,
    legitimateAccuracy,
    avgReadTimeMs,
    avgResponseTimeMs,
    results: responses,
  } = ScamBenchSubmissionSchema.parse(await request.json());

  // Detect source from headers (self-asserted; not verified provenance)
  const mturkAssignmentId = request.headers.get('x-mturk-assignment-id');
  const mturkHitId = request.headers.get('x-mturk-hit-id');
  const mturkWorkerId = request.headers.get('x-mturk-worker-id');
  const source = mturkAssignmentId ? 'mturk' : 'web';

  const totalDurationMs = responses.reduce((sum, r) => sum + r.totalTimeMs, 0);

  const session = await db
    .insert(scambenchSessions)
    .values({
      id: randomUUID(),
      participantId,
      source,
      mturkAssignmentId,
      mturkHitId,
      mturkWorkerId,
      scenarioCount: scenarioCount ?? responses.length,
      overallAccuracy: overallAccuracy ?? 0,
      attackAccuracy: attackAccuracy ?? 0,
      legitimateAccuracy: legitimateAccuracy ?? 0,
      avgReadTimeMs: avgReadTimeMs ?? 0,
      avgResponseTimeMs: avgResponseTimeMs ?? 0,
      totalDurationMs,
      responses,
      userAgent: request.headers.get('user-agent'),
    })
    .returning({ id: scambenchSessions.id });

  return NextResponse.json({
    ok: true,
    sessionId: session[0]?.id,
  });
});

export const GET = withErrorHandling(async function GET() {
  // Aggregate leaderboard
  const stats = await db
    .select({
      totalSessions: count(),
      avgOverall: avg(scambenchSessions.overallAccuracy),
      avgAttack: avg(scambenchSessions.attackAccuracy),
      avgLegit: avg(scambenchSessions.legitimateAccuracy),
      avgReadMs: avg(scambenchSessions.avgReadTimeMs),
      avgRespMs: avg(scambenchSessions.avgResponseTimeMs),
    })
    .from(scambenchSessions);

  // Recent sessions
  const recent = await db
    .select({
      id: scambenchSessions.id,
      participantId: scambenchSessions.participantId,
      source: scambenchSessions.source,
      scenarioCount: scambenchSessions.scenarioCount,
      overallAccuracy: scambenchSessions.overallAccuracy,
      attackAccuracy: scambenchSessions.attackAccuracy,
      legitimateAccuracy: scambenchSessions.legitimateAccuracy,
      avgReadTimeMs: scambenchSessions.avgReadTimeMs,
      avgResponseTimeMs: scambenchSessions.avgResponseTimeMs,
      createdAt: scambenchSessions.createdAt,
    })
    .from(scambenchSessions)
    .orderBy(desc(scambenchSessions.createdAt))
    .limit(50);

  // Top scores
  const topScores = await db
    .select({
      participantId: scambenchSessions.participantId,
      overallAccuracy: scambenchSessions.overallAccuracy,
      attackAccuracy: scambenchSessions.attackAccuracy,
      scenarioCount: scambenchSessions.scenarioCount,
      createdAt: scambenchSessions.createdAt,
    })
    .from(scambenchSessions)
    .orderBy(desc(scambenchSessions.overallAccuracy))
    .limit(20);

  return NextResponse.json({
    aggregate: stats[0],
    recent,
    topScores,
    modelBaselines: [
      {
        name: 'Qwen3.5-4B + SFT (ours)',
        params: '4B',
        overall: 71.0,
        attack: 74.8,
        legit: 67.2,
      },
      {
        name: 'Qwen3 32B',
        params: '32B',
        overall: 70.9,
        attack: 64.0,
        legit: 77.8,
      },
      {
        name: 'Llama 3.1 8B',
        params: '8B',
        overall: 64.6,
        attack: 49.2,
        legit: 80.0,
      },
      {
        name: 'GPT-OSS 120B',
        params: '120B',
        overall: 52.4,
        attack: 27.3,
        legit: 77.5,
      },
    ],
  });
});
