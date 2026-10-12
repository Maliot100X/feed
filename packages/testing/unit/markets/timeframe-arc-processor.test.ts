import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockDbSelectLimit: ReturnType<typeof mock>;
let mockDbSelectOrderBy: ReturnType<typeof mock>;
let mockDbSelectWhere: ReturnType<typeof mock>;
let mockDbSelectFrom: ReturnType<typeof mock>;
let mockDbSelect: ReturnType<typeof mock>;
let mockDbUpdateReturning: ReturnType<typeof mock>;
let mockDbUpdateWhere: ReturnType<typeof mock>;
let mockDbUpdateSet: ReturnType<typeof mock>;
let mockDbUpdate: ReturnType<typeof mock>;

function resetDbMocks() {
  mockDbSelectLimit = mock(async () => []);
  mockDbSelectOrderBy = mock(() => ({ limit: mockDbSelectLimit }));
  mockDbSelectWhere = mock(() => ({ orderBy: mockDbSelectOrderBy }));
  mockDbSelectFrom = mock(() => ({ where: mockDbSelectWhere }));
  mockDbSelect = mock(() => ({ from: mockDbSelectFrom }));

  // Default: conditional update matched the row
  mockDbUpdateReturning = mock(async () => [{ id: 'row' }]);
  mockDbUpdateWhere = mock(() => ({ returning: mockDbUpdateReturning }));
  mockDbUpdateSet = mock(() => ({ where: mockDbUpdateWhere }));
  mockDbUpdate = mock(() => ({ set: mockDbUpdateSet }));
}

resetDbMocks();

const _actualDb = await import('@feed/db');
mock.module('@feed/db', () => ({
  ..._actualDb,
  db: {
    get select() {
      return mockDbSelect;
    },
    get update() {
      return mockDbUpdate;
    },
  },
  timeframedMarkets: {
    id: 'timeframedMarkets.id',
    isActive: 'timeframedMarkets.isActive',
    arcState: 'timeframedMarkets.arcState',
    eventsGenerated: 'timeframedMarkets.eventsGenerated',
    lastEventAt: 'timeframedMarkets.lastEventAt',
  },
}));

const mockLoggerInfo = mock();

const _actualShared = await import('@feed/shared');
mock.module('@feed/shared', () => ({
  ..._actualShared,
  logger: {
    debug: mock(),
    error: mock(),
    info: mockLoggerInfo,
    warn: mock(),
  },
}));

const { TimeframeArcProcessor } = await import(
  '../../../engine/src/services/timeframe-arc-processor'
);

describe('TimeframeArcProcessor', () => {
  beforeEach(() => {
    resetDbMocks();
    mockLoggerInfo.mockClear();
  });

  test('keeps expired markets active while moving them to the terminal arc state', async () => {
    const now = new Date('2026-03-19T20:50:00.000Z');
    const expiredMarket = {
      id: 'market-1',
      timeframe: 'intraday',
      startTime: new Date('2026-03-19T18:50:00.000Z'),
      endTime: new Date('2026-03-19T19:50:00.000Z'),
      arcState: 'active',
      eventsGenerated: 0,
    };

    mockDbSelectLimit.mockResolvedValueOnce([expiredMarket]);

    const processor = new TimeframeArcProcessor();
    const result = await processor.processTick(now);

    expect(result.marketsProcessed).toBe(1);
    expect(result.transitionsOccurred).toBe(1);
    expect(mockDbUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockDbUpdateSet).toHaveBeenCalledWith({
      arcState: 'resolution',
      arcStateEnteredAt: now,
      updatedAt: now,
    });

    const updatePayload = mockDbUpdateSet.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updatePayload).toBeDefined();
    expect(updatePayload).not.toHaveProperty('isActive');
    expect(updatePayload).not.toHaveProperty('isResolved');
    expect(updatePayload).not.toHaveProperty('resolvedAt');
  });

  test('does not rewrite expired markets already in their terminal arc state', async () => {
    const now = new Date('2026-03-19T20:50:00.000Z');
    const expiredMarket = {
      id: 'market-2',
      timeframe: 'flash',
      startTime: new Date('2026-03-19T20:15:00.000Z'),
      endTime: new Date('2026-03-19T20:30:00.000Z'),
      arcState: 'resolving',
      eventsGenerated: 0,
    };

    mockDbSelectLimit.mockResolvedValueOnce([expiredMarket]);

    const processor = new TimeframeArcProcessor();
    const result = await processor.processTick(now);

    expect(result.marketsProcessed).toBe(1);
    expect(result.transitionsOccurred).toBe(0);
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
  });

  test('skips the transition when a concurrent tick already moved the state', async () => {
    const now = new Date('2026-03-19T20:50:00.000Z');
    mockDbUpdateReturning.mockResolvedValueOnce([]);
    const processor = new TimeframeArcProcessor();
    const result = await processor.markResolutionPending(
      {
        id: 'market-3',
        timeframe: 'intraday',
        startTime: new Date('2026-03-19T18:50:00.000Z'),
        endTime: new Date('2026-03-19T19:50:00.000Z'),
        arcState: 'active',
        eventsGenerated: 0,
      } as never,
      now
    );
    expect(result.transitioned).toBe(false);
  });

  test('event generation reports the post-transition arc state', async () => {
    const start = new Date('2026-03-19T18:00:00.000Z');
    const end = new Date('2026-03-19T22:00:00.000Z');
    // ~90% through an intraday market => climax phase; stored row is stale
    const now = new Date('2026-03-19T21:40:00.000Z');
    mockDbSelectLimit.mockResolvedValueOnce([
      {
        id: 'market-4',
        timeframe: 'intraday',
        startTime: start,
        endTime: end,
        arcState: 'setup',
        eventsGenerated: 0,
        lastEventAt: null,
      },
    ]);

    const processor = new TimeframeArcProcessor();
    const result = await processor.processTick(now);

    expect(result.transitionsOccurred).toBe(1);
    const newState = (
      mockDbUpdateSet.mock.calls[0]?.[0] as { arcState: string }
    ).arcState;
    expect(newState).not.toBe('setup');
    for (const trigger of result.eventTriggers) {
      expect(trigger.arcState).toBe(newState);
    }
  });

  test('does not generate events before the market starts', async () => {
    const processor = new TimeframeArcProcessor();
    const event = await processor.tryGenerateEvent(
      {
        id: 'market-5',
        timeframe: 'intraday',
        startTime: new Date('2026-03-19T18:00:00.000Z'),
        endTime: new Date('2026-03-19T22:00:00.000Z'),
        arcState: 'setup',
        eventsGenerated: 0,
        lastEventAt: null,
      } as never,
      new Date('2026-03-19T17:00:00.000Z')
    );
    expect(event).toEqual({
      generated: false,
      marketId: 'market-5',
      reason: 'not_started',
    });
  });

  test('does not generate events for unknown arc states', async () => {
    const processor = new TimeframeArcProcessor();
    const event = await processor.tryGenerateEvent(
      {
        id: 'market-6',
        timeframe: 'intraday',
        startTime: new Date('2026-03-19T18:00:00.000Z'),
        endTime: new Date('2026-03-19T22:00:00.000Z'),
        arcState: 'bogus',
        eventsGenerated: 0,
        lastEventAt: null,
      } as never,
      new Date('2026-03-19T19:00:00.000Z')
    );
    expect(event.generated).toBe(false);
    expect(event.reason).toBe('unknown_state');
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  test('reports cooldown when another tick claimed the event slot', async () => {
    mockDbUpdateReturning.mockResolvedValue([]);
    const processor = new TimeframeArcProcessor();
    // climax has high probability; retry a few times to get past the roll
    let reasons = new Set<string | undefined>();
    for (let i = 0; i < 20; i++) {
      const event = await processor.tryGenerateEvent(
        {
          id: 'market-7',
          timeframe: 'intraday',
          startTime: new Date('2026-03-19T18:00:00.000Z'),
          endTime: new Date('2026-03-19T22:00:00.000Z'),
          arcState: 'climax',
          eventsGenerated: 0,
          lastEventAt: null,
        } as never,
        new Date('2026-03-19T21:00:00.000Z')
      );
      expect(event.generated).toBe(false);
      reasons.add(event.reason);
    }
    reasons = new Set(
      [...reasons].filter((r) => r !== 'probability_check_failed')
    );
    expect([...reasons]).toEqual(['cooldown']);
  });

  test('formats an expired market as ended, not resolved', () => {
    const processor = new TimeframeArcProcessor();
    expect(
      processor.formatTimeRemaining(
        { endTime: new Date('2026-03-19T19:00:00.000Z') } as never,
        new Date('2026-03-19T20:00:00.000Z')
      )
    ).toBe('Ended');
  });
});
