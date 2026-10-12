import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualApi from '@feed/api';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

type UserRow = {
  appealStatus: string;
  appealStaked: boolean;
  appealStakeAmount: string | null;
  appealStakeTxHash?: string | null;
  falsePositiveHistory: actualDb.JsonValue;
};

let user: UserRow;
const credit = mock(async () => undefined);
const notify = mock(async () => undefined);

function selectInReview() {
  const rows = () =>
    Promise.resolve(user.appealStatus === 'human_review' ? [{ ...user }] : []);
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    for: rows,
  };
  return chain;
}

function updateInReview() {
  return {
    set: (values: Partial<UserRow>) => ({
      where: () => {
        const matched = user.appealStatus === 'human_review';
        if (matched) Object.assign(user, values);
        const result = Promise.resolve(undefined);
        return Object.assign(result, {
          returning: async () => (matched ? [{ id: 'user-1' }] : []),
        });
      },
    }),
  };
}

const fakeTx = { select: selectInReview, update: updateInReview };

mock.module('@feed/db', () => ({
  ...actualDb,
  db: { update: updateInReview },
  withTransaction: async (fn: (tx: typeof fakeTx) => Promise<boolean>) =>
    fn(fakeTx),
}));

mock.module('@feed/engine', () => ({
  WalletService: { credit },
}));

mock.module('@feed/api', () => ({
  createNotification: notify,
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: actualApi.withErrorHandling,
}));

const { POST } = await import('../route');

function call(action: 'approve' | 'deny') {
  return POST(
    new Request('http://localhost/api/admin/moderation/human-review/user-1', {
      method: 'POST',
      body: JSON.stringify({ action, reasoning: 'reviewed carefully' }),
    }) as never,
    { params: Promise.resolve({ userId: 'user-1' }) }
  ) as Promise<Response>;
}

describe('POST /api/admin/moderation/human-review/[userId]', () => {
  beforeEach(() => {
    user = {
      appealStatus: 'human_review',
      appealStaked: true,
      appealStakeAmount: '25',
      appealStakeTxHash: '0xstake',
      falsePositiveHistory: null,
    };
    credit.mockReset();
    credit.mockImplementation(async () => undefined);
    notify.mockClear();
  });

  it('credits the stake exactly once across repeated approvals', async () => {
    const first = await call('approve');
    const second = await call('approve');
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(credit).toHaveBeenCalledTimes(1);
    expect(credit.mock.calls[0]?.slice(0, 3)).toEqual([
      'user-1',
      25,
      'appeal_stake_refund',
    ]);
    expect(user.appealStatus).toBe('approved');
    expect(user.appealStaked).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('keeps the stake tx hash so the escrow cannot fund a later appeal', async () => {
    const res = await call('approve');
    expect(res.status).toBe(200);
    expect(user.appealStakeTxHash).toBe('0xstake');
  });

  it('ignores a malformed falsePositiveHistory instead of crashing', async () => {
    user.falsePositiveHistory = { not: 'an array' };
    const res = await call('approve');
    expect(res.status).toBe(200);
    expect(Array.isArray(user.falsePositiveHistory)).toBe(true);
  });

  it('propagates credit failures (transaction rolls back)', async () => {
    credit.mockImplementation(async () => {
      throw new Error('ledger down');
    });
    const res = await call('approve');
    expect(res.status).toBe(500);
    expect(notify).not.toHaveBeenCalled();
  });

  it('deny cannot overwrite an already-approved appeal', async () => {
    await call('approve');
    const res = await call('deny');
    expect(res.status).toBe(409);
    expect(user.appealStatus).toBe('approved');
  });
});
