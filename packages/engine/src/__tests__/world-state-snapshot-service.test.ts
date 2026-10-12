import { beforeEach, describe, expect, mock, test } from 'bun:test';

type Table = { __name: string };

const orderByCalls: Array<{ table: string; order: unknown[] }> = [];
const inserted: Array<Record<string, unknown>> = [];
let failingTable: string | null = null;
let snapshotRows: Array<{ id: string }> = [];

function column(table: string, name: string) {
  return { table, name };
}

const dbMock = {
  select: mock(() => ({
    from: mock((table: Table) => {
      const chain = {
        where: mock(() => chain),
        orderBy: mock((...order: unknown[]) => {
          orderByCalls.push({ table: table.__name, order });
          return chain;
        }),
        limit: mock(async () => {
          if (failingTable === table.__name) {
            throw new Error(`query failed: ${table.__name}`);
          }
          return table.__name === 'worldStateSnapshots' ? snapshotRows : [];
        }),
      };
      return chain;
    }),
  })),
  insert: mock(() => ({
    values: mock(async (values: Record<string, unknown>) => {
      inserted.push(values);
    }),
  })),
};

function table(
  name: string,
  columns: string[]
): Table & Record<string, unknown> {
  return Object.fromEntries([
    ['__name', name],
    ...columns.map((c) => [c, column(name, c)]),
  ]) as Table & Record<string, unknown>;
}

mock.module('@feed/db', () => ({
  db: dbMock,
  asc: (value: unknown) => ({ asc: value }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (a: unknown, b: unknown) => [a, b],
  generateSnowflakeId: mock(async () => 'snap-1'),
  questions: table('questions', [
    'id',
    'text',
    'status',
    'resolvedOutcome',
    'createdAt',
  ]),
  organizationState: table('organizationState', [
    'id',
    'currentPrice',
    'basePrice',
  ]),
  worldEvents: table('worldEvents', [
    'id',
    'eventType',
    'description',
    'timestamp',
  ]),
  questionArcPlans: table('questionArcPlans', [
    'id',
    'questionId',
    'insiderActorIds',
    'deceiverActorIds',
    'createdAt',
  ]),
  worldStateSnapshots: table('worldStateSnapshots', [
    'id',
    'windowId',
    'gameTime',
  ]),
}));

import { WorldStateSnapshotService } from '../services/world-state-snapshot-service';

describe('WorldStateSnapshotService', () => {
  beforeEach(() => {
    orderByCalls.length = 0;
    inserted.length = 0;
    failingTable = null;
    snapshotRows = [];
  });

  test('getLatestSnapshot orders by capture time then id, newest first', async () => {
    snapshotRows = [{ id: 'latest' }];
    const id = await WorldStateSnapshotService.getLatestSnapshot('w1');
    expect(id).toBe('latest');
    expect(orderByCalls).toEqual([
      {
        table: 'worldStateSnapshots',
        order: [
          { desc: column('worldStateSnapshots', 'gameTime') },
          { desc: column('worldStateSnapshots', 'id') },
        ],
      },
    ]);
  });

  test.each([
    'questions',
    'organizationState',
    'worldEvents',
    'questionArcPlans',
  ])('captureSnapshot rejects and writes nothing when %s query fails', async (name) => {
    failingTable = name;
    await expect(
      WorldStateSnapshotService.captureSnapshot('w1', 'pack')
    ).rejects.toThrow(`query failed: ${name}`);
    expect(inserted).toEqual([]);
  });

  test('captureSnapshot writes ordered sections and no placeholder arc data', async () => {
    const id = await WorldStateSnapshotService.captureSnapshot('w1', 'pack');
    expect(id).toBe('snap-1');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: 'snap-1',
      windowId: 'w1',
      packId: 'pack',
      arcPhase: null,
      arcPlanJson: null,
    });
    const orderedTables = orderByCalls.map((c) => c.table).sort();
    expect(orderedTables).toEqual([
      'organizationState',
      'organizationState',
      'questionArcPlans',
      'questions',
      'worldEvents',
    ]);
  });
});
