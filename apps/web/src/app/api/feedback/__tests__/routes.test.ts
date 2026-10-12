import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

type FakeUser = { id: string; isAgent: boolean };

const users: Record<string, FakeUser> = {
  'agent-1': { id: 'agent-1', isAgent: true },
  'human-1': { id: 'human-1', isAgent: false },
  'human-2': { id: 'human-2', isAgent: false },
};

const mockFeedbackCreate = mock(
  async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    createdAt: new Date(),
  })
);
const mockUpdateFeedbackMetrics = mock(async () => undefined);
const mockUpdateGameMetrics = mock(async () => undefined);
const mockGenerateGameFeedback = mock();

mock.module('@feed/api', () => ({
  authenticate: async () => ({ userId: 'human-1' }),
  BadRequestError: class extends Error {},
  BusinessLogicError: class extends Error {},
  InternalServerError: class extends Error {},
  requireCronAuth: () => undefined,
  requireUserByIdentifier: async (identifier: string) => {
    const user = users[identifier];
    if (!user) throw new Error(`User ${identifier} not found`);
    return user;
  },
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/db', () => ({
  db: {
    feedback: { findFirst: async () => null, create: mockFeedbackCreate },
    agentPerformanceMetrics: { findUnique: async () => null },
  },
}));

mock.module('@feed/engine', () => ({
  generateGameCompletionFeedback: mockGenerateGameFeedback,
  generateTradeCompletionFeedback: mock(),
  updateFeedbackMetrics: mockUpdateFeedbackMetrics,
  updateGameMetrics: mockUpdateGameMetrics,
}));

mock.module('@feed/shared', () => ({
  generateSnowflakeId: async () => 'feedback-1',
  logger: { info: mock(), warn: mock(), error: mock(), debug: mock() },
}));

const { POST: gameToAgent } = await import('../game-to-agent/route');
const { POST: agentToUser } = await import('../agent-to-user/route');
const { POST: autoGenerate } = await import('../auto-generate/route');
const { POST: submit } = await import('../submit/route');

function post(body: unknown): NextRequest {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('feedback subject eligibility', () => {
  beforeEach(() => {
    mockFeedbackCreate.mockClear();
    mockUpdateGameMetrics.mockClear();
    mockUpdateFeedbackMetrics.mockClear();
    mockGenerateGameFeedback.mockClear();
  });

  it('game-to-agent rejects a non-agent subject without writing', async () => {
    const response = (await gameToAgent(
      post({ agentId: 'human-1', gameId: 'g1', score: 80, won: true })
    )) as Response;

    expect(response.status).toBe(400);
    expect(mockFeedbackCreate).not.toHaveBeenCalled();
    expect(mockUpdateGameMetrics).not.toHaveBeenCalled();
  });

  it('agent-to-user rejects a non-agent author without writing', async () => {
    const response = (await agentToUser(
      post({ agentId: 'human-1', toUserId: 'human-2', score: 80 })
    )) as Response;

    expect(response.status).toBe(400);
    expect(mockFeedbackCreate).not.toHaveBeenCalled();
  });

  it('auto-generate rejects a non-agent subject without generating', async () => {
    const response = (await autoGenerate(
      post({
        type: 'game',
        agentId: 'human-1',
        gameId: 'g1',
        metrics: {
          won: true,
          pnl: 10,
          positionsClosed: 2,
          finalBalance: 110,
          startingBalance: 100,
          decisionsCorrect: 3,
          decisionsTotal: 4,
        },
      })
    )) as Response;

    expect(response.status).toBe(400);
    expect(mockGenerateGameFeedback).not.toHaveBeenCalled();
  });

  it('game-to-agent still records feedback for agents', async () => {
    const response = (await gameToAgent(
      post({ agentId: 'agent-1', gameId: 'g1', score: 80, won: true })
    )) as Response;

    expect(response.status).toBe(201);
    expect(mockFeedbackCreate).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/feedback/submit', () => {
  beforeEach(() => {
    mockFeedbackCreate.mockClear();
  });

  it('rejects ambiguous score + stars input', async () => {
    await expect(
      submit(post({ toUserId: 'agent-1', score: 10, stars: 5 }))
    ).rejects.toThrow();
    expect(mockFeedbackCreate).not.toHaveBeenCalled();
  });

  it('accepts the null comment that FeedbackForm sends', async () => {
    const response = (await submit(
      post({ toUserId: 'agent-1', score: 70, comment: null })
    )) as Response;

    expect(response.status).toBe(201);
    expect(mockFeedbackCreate).toHaveBeenCalledTimes(1);
  });
});
