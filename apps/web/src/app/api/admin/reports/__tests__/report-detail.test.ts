import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualApi from '@feed/api';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

type Report = {
  id: string;
  reportedUserId: string | null;
  reportedPostId: string | null;
  reportedCommentId: string | null;
  resolution: string | null;
};

let report: Report;
const relatedQueries: object[] = [];

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    report: {
      findUnique: async () => report,
      findMany: async (args: { where: object }) => {
        relatedQueries.push(args.where);
        return [];
      },
    },
  },
}));

mock.module('@feed/api', () => ({
  BusinessLogicError: actualApi.BusinessLogicError,
  NotFoundError: actualApi.NotFoundError,
  evaluateReport: async () => null,
  storeEvaluationResult: async () => undefined,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: () => Promise<Response>) => handler,
}));

const { GET } = await import('../[reportId]/route');
const { parseStoredEvaluation } = await import('../_evaluation');

function get() {
  return GET(new Request('http://localhost/api/admin/reports/r1') as never, {
    params: Promise.resolve({ reportId: 'r1' }),
  }) as Promise<Response>;
}

const evaluation = {
  outcome: 'valid_report',
  confidence: 0.9,
  reasoning: 'clear',
  recommendedActions: [],
  evidenceSummary: {
    chatMessages: 1,
    posts: 0,
    reportsReceived: 2,
    reportsSent: 0,
  },
};

describe('parseStoredEvaluation', () => {
  it('returns null for human prose that starts with a brace', () => {
    expect(parseStoredEvaluation('{not json, just notes')).toBeNull();
    expect(parseStoredEvaluation('[context] user was warned')).toBeNull();
    expect(parseStoredEvaluation('{"note":"json but not an eval"}')).toBeNull();
    expect(parseStoredEvaluation(null)).toBeNull();
  });

  it('parses a stored evaluation', () => {
    expect(parseStoredEvaluation(JSON.stringify(evaluation))).toEqual(
      evaluation as ReturnType<typeof parseStoredEvaluation>
    );
  });
});

describe('GET /api/admin/reports/[reportId]', () => {
  beforeEach(() => {
    relatedQueries.length = 0;
    report = {
      id: 'r1',
      reportedUserId: null,
      reportedPostId: null,
      reportedCommentId: null,
      resolution: '{ moderator note',
    };
  });

  it('does not crash on brace-prefixed human resolution', async () => {
    report.reportedUserId = 'u1';
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).report.evaluation).toBeNull();
  });

  it('only matches non-null subjects for related reports', async () => {
    report.reportedPostId = 'p1';
    await get();
    expect(relatedQueries[0]).toEqual({
      OR: [{ reportedPostId: 'p1' }],
      id: { not: 'r1' },
    });
  });

  it('matches comment-only reports by comment id', async () => {
    report.reportedCommentId = 'c1';
    await get();
    expect(relatedQueries[0]).toEqual({
      OR: [{ reportedCommentId: 'c1' }],
      id: { not: 'r1' },
    });
  });

  it('skips the related query when the report has no subject', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(relatedQueries).toHaveLength(0);
  });
});
