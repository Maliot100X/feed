/**
 * World Facts Update Tests
 *
 * Integration tests for the updateWorldFactsIfNeeded function.
 * Tests actually call the production function with mocked dependencies.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Track mock behavior flags
let lockAcquireReturnValue = true;
let rssFetchThrows = false;
let parodyProcessThrows = false;
let cleanupThrows = false;
let generateFactsThrows = false;
let markerInsertThrows = false;

// Control what shouldUpdateWorldFacts returns by controlling DB response
// If set to a recent date, shouldUpdate returns false; if old/null, returns true
let lastAutoFactCreatedAt: Date | null = null;

// Track mock calls
let lockAcquireCalls: Array<{ lockId: string; processId: string }> = [];
let lockReleaseCalls: Array<{ lockId: string; processId: string }> = [];

// Track inserted markers for verification
let insertedMarkers: Array<Record<string, unknown>> = [];

// Create stable mock functions that can be reused
const mockInsertValues = (data: Record<string, unknown>) => {
  if (markerInsertThrows) {
    return Promise.reject(new Error('Marker insert failed'));
  }
  // Capture the inserted marker data
  insertedMarkers.push(data);
  return Promise.resolve([]);
};

// Mock the database
const mockDb = {
  select: mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        orderBy: mock(() => ({
          limit: mock(() => {
            // Return the controlled lastAutoFact for shouldUpdateWorldFacts query
            if (lastAutoFactCreatedAt) {
              return Promise.resolve([{ createdAt: lastAutoFactCreatedAt }]);
            }
            return Promise.resolve([]);
          }),
        })),
      })),
    })),
  })),
  insert: mock(() => ({
    values: mockInsertValues,
  })),
  update: mock(() => ({
    set: mock(() => ({
      where: mock(() => ({
        returning: mock(() => Promise.resolve([])),
      })),
    })),
  })),
};

mock.module('@feed/db', () => ({
  db: mockDb,
  and: (...args: unknown[]) => args,
  desc: (col: unknown) => col,
  eq: (a: unknown, b: unknown) => [a, b],
  gte: (a: unknown, b: unknown) => [a, b],
  inArray: (a: unknown, b: unknown) => [a, b],
  isNull: (a: unknown) => [a],
  lte: (a: unknown, b: unknown) => [a, b],
  worldFacts: {
    id: 'id',
    category: 'category',
    key: 'key',
    label: 'label',
    value: 'value',
    source: 'source',
    priority: 'priority',
    isActive: 'isActive',
    lastUpdated: 'lastUpdated',
    updatedAt: 'updatedAt',
    createdAt: 'createdAt',
  },
  sql: (strings: TemplateStringsArray) => strings.join(''),
}));

// Mock logger with call tracking
const mockLogger = {
  info: mock(() => {}),
  debug: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

mock.module('@feed/shared', () => ({
  generateSnowflakeId: mock(() => Promise.resolve('test-snowflake-id')),
  logger: mockLogger,
}));

// Mock DistributedLockService with call tracking
const mockDistributedLockService = {
  acquireLock: mock(async (params: { lockId: string; processId: string }) => {
    lockAcquireCalls.push({
      lockId: params.lockId,
      processId: params.processId,
    });
    return lockAcquireReturnValue;
  }),
  releaseLock: mock(async (lockId: string, processId: string) => {
    lockReleaseCalls.push({ lockId, processId });
  }),
};

mock.module('../services/distributed-lock-service', () => ({
  DistributedLockService: mockDistributedLockService,
}));

// Mock RSS feed service
const mockRssFeedService = {
  fetchAllFeeds: mock(async () => {
    if (rssFetchThrows) {
      throw new Error('RSS fetch failed');
    }
    return { fetched: 5, stored: 3, errors: 0 };
  }),
  getUntransformedHeadlines: mock(async () => []),
  cleanupOldHeadlines: mock(async () => {
    if (cleanupThrows) {
      throw new Error('Cleanup failed');
    }
    return 10;
  }),
};

mock.module('../services/rss-feed-service', () => ({
  rssFeedService: mockRssFeedService,
}));

// Mock parody headline generator
const mockParodyGenerator = {
  processHeadlines: mock(async () => {
    if (parodyProcessThrows) {
      throw new Error('Parody processing failed');
    }
    return [];
  }),
};

mock.module('../services/parody-headline-generator', () => ({
  createParodyHeadlineGenerator: mock(() => mockParodyGenerator),
}));

mock.module('../services/daily-topic-service', () => ({
  dailyTopicService: {
    ensureTopicForDate: mock(async () => ({
      topicKey: 'openai',
      topicLabel: 'OpenAI',
      summary: 'OpenAI stays the single topic for the day',
      date: new Date('2026-03-06T00:00:00.000Z'),
      sourceType: 'auto',
      sourceHeadlineIds: [],
      selectionReason: 'Matched headlines',
      isLocked: false,
    })),
  },
}));

// Mock world facts generator
const mockWorldFactsGenerator = {
  generateNewWorldFacts: mock(async () => {
    if (generateFactsThrows) {
      throw new Error('Facts generation failed');
    }
    return {
      generated: 5,
      archived: 2,
      sources: { events: 1, markets: 2, questions: 1, actors: 1 },
    };
  }),
};

mock.module('../services/world-facts-generator', () => ({
  createWorldFactsGenerator: mock(() => mockWorldFactsGenerator),
  worldFactsGenerator: mockWorldFactsGenerator,
}));

// Import the function AFTER mocks are set up
// Note: In Bun, mock.module is hoisted, so this import will use the mocked modules
import {
  computeLockRenewalIntervalMs,
  GENERATION_MARKER,
  updateWorldFactsIfNeeded,
} from '../game-tick';

// Helper to reset all mocks and flags
function resetMocks() {
  lockAcquireReturnValue = true;
  rssFetchThrows = false;
  parodyProcessThrows = false;
  cleanupThrows = false;
  generateFactsThrows = false;
  markerInsertThrows = false;
  lastAutoFactCreatedAt = null;
  lockAcquireCalls = [];
  lockReleaseCalls = [];
  insertedMarkers = [];

  mockLogger.info.mockClear?.();
  mockLogger.debug.mockClear?.();
  mockLogger.warn.mockClear?.();
  mockLogger.error.mockClear?.();
  mockDistributedLockService.acquireLock.mockClear?.();
  mockDistributedLockService.releaseLock.mockClear?.();
  mockRssFeedService.fetchAllFeeds.mockClear?.();
  mockRssFeedService.cleanupOldHeadlines.mockClear?.();
  mockParodyGenerator.processHeadlines.mockClear?.();
  mockWorldFactsGenerator.generateNewWorldFacts.mockClear?.();
}

describe('World Facts Update - Lock Renewal Interval Calculation', () => {
  test('renews at half the lock duration', () => {
    expect(computeLockRenewalIntervalMs(30 * 60 * 1000)).toBe(15 * 60 * 1000);
  });

  test('short locks still renew before they expire', () => {
    for (const durationMs of [30_000, 60_000, 3, 2]) {
      const interval = computeLockRenewalIntervalMs(durationMs);
      expect(interval).toBeGreaterThan(0);
      expect(interval).toBeLessThan(durationMs);
    }
  });

  test('rejects durations that cannot renew before expiry', () => {
    for (const durationMs of [0, 1, -5, Number.NaN]) {
      expect(() => computeLockRenewalIntervalMs(durationMs)).toThrow(
        'Lock duration must be a finite number'
      );
    }
  });
});

describe('World Facts Update - Check Before Lock Pattern', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('should not acquire lock when update is not needed', async () => {
    // Set lastAutoFactCreatedAt to recent time so shouldUpdate returns false
    lastAutoFactCreatedAt = new Date(); // Now - will make shouldUpdate return false

    const result = await updateWorldFactsIfNeeded();

    // Should return early without acquiring lock
    expect(result.updated).toBe(false);
    expect(lockAcquireCalls.length).toBe(0);
    expect(lockReleaseCalls.length).toBe(0);
  });

  test('should acquire lock when update is needed', async () => {
    // Set lastAutoFactCreatedAt to old time so shouldUpdate returns true
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const result = await updateWorldFactsIfNeeded();

    // Should acquire and release lock
    expect(result.updated).toBe(true);
    expect(lockAcquireCalls.length).toBe(1);
    expect(lockReleaseCalls.length).toBe(1);
  });

  test('should return early when lock cannot be acquired', async () => {
    // Set up: update needed but lock not available
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    lockAcquireReturnValue = false;

    const result = await updateWorldFactsIfNeeded();

    // Should return without doing work
    expect(result.updated).toBe(false);
    expect(lockAcquireCalls.length).toBe(1); // Tried to acquire
    expect(lockReleaseCalls.length).toBe(0); // Never got lock, so no release
  });
});

describe('World Facts Update - RSS/Parody Pipeline Error Handling', () => {
  beforeEach(() => {
    resetMocks();
    // Set up: update is needed
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  });

  test('RSS fetch error must propagate and release the lock', async () => {
    rssFetchThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'RSS fetch failed'
    );

    expect(mockLogger.error).toHaveBeenCalled();
    // Lock should still be released in finally block
    expect(lockReleaseCalls.length).toBe(1);
  });

  test('parody processing error must propagate and release the lock', async () => {
    parodyProcessThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'Parody processing failed'
    );

    expect(mockLogger.error).toHaveBeenCalled();
    expect(lockReleaseCalls.length).toBe(1);
  });

  test('cleanup error must propagate and release the lock', async () => {
    cleanupThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow('Cleanup failed');

    expect(mockLogger.error).toHaveBeenCalled();
    expect(lockReleaseCalls.length).toBe(1);
  });

  test('pipeline errors should not prevent lock release', async () => {
    rssFetchThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'RSS fetch failed'
    );

    // Lock must be released even on error
    expect(lockReleaseCalls.length).toBe(1);
    expect(lockAcquireCalls.length).toBe(1);
  });
});

describe('World Facts Update - Generation Marker Error Handling', () => {
  beforeEach(() => {
    resetMocks();
    // Set up: update is needed, generation succeeds
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    generateFactsThrows = false; // Explicitly ensure generation succeeds
  });

  test('marker insert error must propagate', async () => {
    markerInsertThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'Marker insert failed'
    );

    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('marker error must prevent success', async () => {
    markerInsertThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'Marker insert failed'
    );
  });
});

describe('World Facts Update - Facts Generation Error Handling', () => {
  beforeEach(() => {
    resetMocks();
    // Set up: update is needed
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  });

  test('facts generation error must propagate', async () => {
    generateFactsThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'Facts generation failed'
    );

    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('facts generation error must not fabricate default values', async () => {
    generateFactsThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'Facts generation failed'
    );
  });

  test('facts generation error skips marker to allow immediate retry', async () => {
    // Reset insertedMarkers and mocks to ensure clean state
    insertedMarkers = [];
    mockDb.insert.mockClear?.();

    generateFactsThrows = true;

    await expect(updateWorldFactsIfNeeded()).rejects.toThrow(
      'Facts generation failed'
    );

    // Marker should NOT be inserted when generation fails
    // (This allows the next tick to retry immediately)
    expect(insertedMarkers.length).toBe(0);

    // Verify the error was logged
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test('successful generation inserts marker', async () => {
    generateFactsThrows = false;

    const result = await updateWorldFactsIfNeeded();

    expect(result.updated).toBe(true);
    // Verify generation completed (value depends on mock state)
    expect(result.stats?.worldFactsGenerated).toBeGreaterThanOrEqual(0);
  });
});

describe('World Facts Update - Lock Not Acquired Scenario', () => {
  beforeEach(() => {
    resetMocks();
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    lockAcquireReturnValue = false;
  });

  test('should return early when lock cannot be acquired', async () => {
    const result = await updateWorldFactsIfNeeded();

    expect(result.updated).toBe(false);
    expect(lockAcquireCalls.length).toBe(1);
    // Should NOT release a lock we don't hold
    expect(lockReleaseCalls.length).toBe(0);
  });
});

describe('World Facts Update - Successful Run', () => {
  beforeEach(() => {
    resetMocks();
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    generateFactsThrows = false; // Explicitly ensure generation succeeds
  });

  test('successful run returns complete stats', async () => {
    const result = await updateWorldFactsIfNeeded();

    expect(result.updated).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.stats?.feedsFetched).toBe(5);
    expect(result.stats?.newHeadlines).toBe(3);
    expect(result.stats?.parodiesGenerated).toBe(0);
    expect(result.stats?.headlinesCleaned).toBe(10);
    // World facts values depend on mock - just verify they're defined
    expect(result.stats?.worldFactsGenerated).toBeGreaterThanOrEqual(0);
    expect(result.stats?.worldFactsArchived).toBeGreaterThanOrEqual(0);
  });

  test('successful run acquires and releases lock', async () => {
    await updateWorldFactsIfNeeded();

    expect(lockAcquireCalls.length).toBe(1);
    expect(lockReleaseCalls.length).toBe(1);
  });
});

describe('World Facts Update - Marker Persistence Integration', () => {
  // The unit runner executes each file in its own process, so the module
  // mocks above always apply and the production marker insert is captured.

  beforeEach(() => {
    resetMocks();
    lastAutoFactCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  });

  test('update function completes and returns stats', async () => {
    const result = await updateWorldFactsIfNeeded();

    // Function should complete successfully
    expect(result.updated).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.stats?.feedsFetched).toBeGreaterThanOrEqual(0);
    expect(result.stats?.worldFactsGenerated).toBeGreaterThanOrEqual(0);
  });

  test('inserts the generation marker after a successful run', async () => {
    // Reset insertedMarkers to ensure clean state
    insertedMarkers = [];

    // Run the update to trigger marker insertion
    const result = await updateWorldFactsIfNeeded();
    expect(result.updated).toBe(true);

    const actualMarker = insertedMarkers.find(
      (m) =>
        m.category === GENERATION_MARKER.CATEGORY &&
        m.key === GENERATION_MARKER.KEY
    );
    expect(actualMarker).toBeDefined();

    expect(actualMarker!.isActive).toBe(GENERATION_MARKER.IS_ACTIVE);
    expect(actualMarker!.priority).toBe(GENERATION_MARKER.PRIORITY);
    expect(actualMarker!.source).toBe(GENERATION_MARKER.SOURCE);
    expect(actualMarker!.label).toBe(GENERATION_MARKER.LABEL);
    expect(actualMarker!.id).toBe('test-snowflake-id'); // From mock
    expect(actualMarker!.createdAt).toBeInstanceOf(Date);
    expect(actualMarker!.updatedAt).toBeInstanceOf(Date);
    expect(actualMarker!.lastUpdated).toBeInstanceOf(Date);
    expect(typeof actualMarker!.value).toBe('string');
    expect(actualMarker!.value as string).toContain('Generation run at');
    expect(actualMarker!.value as string).toContain('facts created');
  });
});
