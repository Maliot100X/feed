import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

type Feedback = {
  id: string;
  fromUserId: string | null;
  interactionType: string;
  metadata: object | null;
};

let feedback: Feedback | null;
let metadataAfterSync: object | null = null;
const syncFeedbackToLinear = mock(async () => {
  if (feedback) feedback = { ...feedback, metadata: metadataAfterSync };
});

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    feedback: { findUnique: async () => feedback },
    user: { findUnique: async () => ({ id: 'u1', email: null }) },
  },
}));

mock.module('@feed/api', () => ({
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  getLinearConfig: () => ({ apiKey: 'test', teamId: 'team' }),
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  syncFeedbackToLinear,
  withErrorHandling: (handler: () => Promise<Response>) => handler,
}));

const { POST } = await import('../[feedbackId]/retry-sync/route');
const list = (await import('../route')).GET;

function retry() {
  return POST(new Request('http://localhost/x', { method: 'POST' }) as never, {
    params: Promise.resolve({ feedbackId: 'f1' }),
  }) as Promise<Response>;
}

async function code(res: Response) {
  return (await res.json()).error?.code;
}

describe('feedback retry-sync', () => {
  beforeEach(() => {
    feedback = {
      id: 'f1',
      fromUserId: 'u1',
      interactionType: 'general_game_feedback',
      metadata: {},
    };
    metadataAfterSync = null;
    syncFeedbackToLinear.mockClear();
  });

  it('refuses corrupt sync metadata instead of creating a duplicate issue', async () => {
    feedback = { ...(feedback as Feedback), metadata: { linearIssueId: 123 } };
    const res = await retry();
    expect(res.status).toBe(409);
    expect(syncFeedbackToLinear).not.toHaveBeenCalled();
  });

  it('refuses array metadata without throwing', async () => {
    feedback = { ...(feedback as Feedback), metadata: [] };
    expect((await retry()).status).toBe(409);
  });

  it('only syncs general game feedback', async () => {
    feedback = { ...(feedback as Feedback), interactionType: 'npc_rating' };
    const res = await retry();
    expect(await code(res)).toBe('NOT_GAME_FEEDBACK');
  });

  it('reports failure when the sync recorded no issue', async () => {
    const res = await retry();
    expect(res.status).toBe(502);
    expect(await code(res)).toBe('SYNC_INCOMPLETE');
  });

  it('returns the recorded issue on success', async () => {
    metadataAfterSync = {
      linearIssueId: 'iss-1',
      linearIssueIdentifier: 'F-1',
    };
    const res = await retry();
    expect(res.status).toBe(200);
    expect((await res.json()).linearIssue.id).toBe('iss-1');
  });
});

describe('feedback list query validation', () => {
  it('rejects junk limits and invalid dates instead of ignoring them', async () => {
    for (const q of ['limit=12junk', 'fromDate=nope', 'hasLinearIssue=maybe']) {
      const res = (await list(
        new Request(`http://localhost/api/admin/feedback?${q}`) as never
      )) as Response;
      expect(res.status).toBe(400);
    }
  });
});
