import { beforeEach, describe, expect, mock, test } from 'bun:test';

type Row = { id: string; recentMemories: unknown[]; updatedAt: Date };

const rows = new Map<string, Row>();
const creates: unknown[] = [];
let interleave: ((id: string) => void) | null = null;

const actorState = {
  findMany: mock(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => rows.has(id)).map((id) => ({ ...rows.get(id)! }))
  ),
  findFirst: mock(async ({ where }: { where: { id: string } }) => {
    const row = rows.get(where.id);
    return row ? { ...row } : null;
  }),
  updateMany: mock(
    async ({
      where,
      data,
    }: {
      where: { id: string; updatedAt?: Date };
      data: { recentMemories: unknown[]; updatedAt: Date };
    }) => {
      if (interleave) {
        const fn = interleave;
        interleave = null;
        fn(where.id);
      }
      const row = rows.get(where.id);
      if (!row) return { count: 0 };
      if (
        where.updatedAt &&
        row.updatedAt.getTime() !== where.updatedAt.getTime()
      ) {
        return { count: 0 };
      }
      rows.set(where.id, { ...row, ...data });
      return { count: 1 };
    }
  ),
  create: mock(async (args: unknown) => {
    creates.push(args);
    return args;
  }),
};

mock.module('@feed/db', () => ({ db: { actorState } }));

const { ensureRunningBits } = await import(
  '../../services/npc-running-bit-service'
);

const NOW = new Date('2026-03-01T12:00:00.000Z');

beforeEach(() => {
  rows.clear();
  creates.length = 0;
  interleave = null;
});

describe('ensureRunningBits', () => {
  test('does not mint ActorState for unknown actors', async () => {
    const result = await ensureRunningBits(['ghost'], {
      now: NOW,
      currentDay: 3,
    });
    expect(result).toEqual({});
    expect(creates).toHaveLength(0);
  });

  test('preserves memories written concurrently instead of overwriting', async () => {
    const t0 = new Date('2026-03-01T00:00:00.000Z');
    rows.set('npc-1', { id: 'npc-1', recentMemories: [], updatedAt: t0 });

    // A concurrent writer appends a memory between our read and our write.
    interleave = (id) => {
      const row = rows.get(id)!;
      rows.set(id, {
        ...row,
        recentMemories: [
          ...row.recentMemories,
          {
            id: 'other',
            type: 'posted',
            timestamp: NOW.toISOString(),
            summary: 'concurrent memory',
            sentiment: 0,
          },
        ],
        updatedAt: new Date('2026-03-01T06:00:00.000Z'),
      });
    };

    const result = await ensureRunningBits(['npc-1', 'npc-1'], {
      now: NOW,
      currentDay: 3,
    });

    expect(Object.keys(result)).toEqual(['npc-1']);
    const stored = rows.get('npc-1')!.recentMemories as Array<{
      summary: string;
      type: string;
    }>;
    expect(stored.some((m) => m.summary === 'concurrent memory')).toBe(true);
    expect(stored.some((m) => m.type === 'running_bit')).toBe(true);
  });
});
