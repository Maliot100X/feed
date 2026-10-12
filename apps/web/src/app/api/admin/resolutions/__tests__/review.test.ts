import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

let existing: object | null;
let updatedRows: { id: string }[] = [];

function selectChain() {
  const c = {
    from: () => c,
    where: () => c,
    limit: async () => (existing ? [existing] : []),
  };
  return c;
}

function updateChain() {
  const c = {
    set: () => c,
    where: () => c,
    returning: async () => updatedRows,
  };
  return c;
}

mock.module('@feed/db', () => ({
  ...actualDb,
  db: { select: selectChain, update: updateChain },
}));

mock.module('@feed/api', () => ({
  checkRateLimitAndDuplicates: () => null,
  RATE_LIMIT_CONFIGS: { ADMIN_ACTION: {} },
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: () => Promise<Response>) => handler,
}));

const { POST } = await import('../[id]/route');

function call(action: 'approve' | 'reject') {
  return POST(
    new Request('http://localhost/api/admin/resolutions/q1', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }) as never,
    { params: Promise.resolve({ id: 'q1' }) }
  ) as Promise<Response>;
}

describe('POST /api/admin/resolutions/[id]', () => {
  beforeEach(() => {
    existing = {
      id: 'q1',
      questionNumber: 1,
      status: 'active',
      requiresManualReview: true,
      resolutionReviewStatus: null,
    };
    updatedRows = [];
  });

  it('returns 409 when a concurrent decision already changed the state', async () => {
    const res = await call('approve');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('REVIEW_CONFLICT');
  });

  it('approves when the compare-and-set matches', async () => {
    updatedRows = [{ id: 'q1' }];
    expect((await call('approve')).status).toBe(200);
  });

  it('reject also uses the compare-and-set', async () => {
    expect((await call('reject')).status).toBe(409);
    updatedRows = [{ id: 'q1' }];
    const res = await call('reject');
    expect(res.status).toBe(200);
    expect((await res.json()).postponedUntil).toBeString();
  });
});
