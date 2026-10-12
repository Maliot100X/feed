import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

class TestBadRequestError extends Error {}

type GameRow = {
  id: string;
  isRunning: boolean;
  currentDay: number;
  currentDate: Date;
  lastTickAt: Date | null;
  startedAt: Date | null;
  pausedAt: Date | null;
};

let game: GameRow;
const mockUpdate = mock(
  async ({ data }: { data: Partial<GameRow> }): Promise<GameRow> => {
    game = { ...game, ...data };
    return game;
  }
);

mock.module('@feed/api', () => ({
  BadRequestError: TestBadRequestError,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/db', () => ({
  asSystem: async (callback: (db: unknown) => Promise<unknown>) =>
    callback({
      game: {
        findFirst: async () => game,
        create: async () => game,
        update: mockUpdate,
      },
    }),
}));

mock.module('@feed/shared', () => ({
  generateSnowflakeId: async () => 'game-1',
  logger: { info: mock(), warn: mock(), error: mock() },
  toISO: (value: Date) => value.toISOString(),
  toISOOrNull: (value: Date | null) => (value ? value.toISOString() : null),
}));

const { POST } = await import('../route');

function control(body: string): NextRequest {
  return new Request('http://localhost/api/game/control', {
    method: 'POST',
    body,
  }) as unknown as NextRequest;
}

describe('POST /api/game/control', () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    game = {
      id: 'game-1',
      isRunning: false,
      currentDay: 3,
      currentDate: new Date('2026-01-01T00:00:00Z'),
      lastTickAt: null,
      startedAt: new Date('2025-12-01T00:00:00Z'),
      pausedAt: new Date('2025-12-31T00:00:00Z'),
    };
  });

  it('clears pausedAt when resuming', async () => {
    await POST(control('{"action":"start"}'));

    const [args] = mockUpdate.mock.calls[0] as unknown as [
      { data: Partial<GameRow> },
    ];
    expect(args.data).toHaveProperty('pausedAt', null);
    expect(game.pausedAt).toBeNull();
    expect(game.isRunning).toBe(true);
  });

  it('keeps the original pause time when pausing an already paused game', async () => {
    const originalPause = game.pausedAt;
    await POST(control('{"action":"pause"}'));

    expect(game.pausedAt).toEqual(originalPause);
  });

  it('rejects null, malformed and unknown-action bodies without mutating', async () => {
    for (const body of ['null', '{', '{"action":"stop"}']) {
      await expect(POST(control(body))).rejects.toBeInstanceOf(
        TestBadRequestError
      );
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
