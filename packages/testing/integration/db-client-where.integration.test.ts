/**
 * Prisma-style repository wrapper: filters never silently broaden, and
 * mutation results report what actually happened.
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db, inArray, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';

const runId = crypto.randomUUID().slice(0, 8);
const ids: string[] = [];
const fixedDate = new Date('2026-03-04T05:06:07.000Z');

describe('db repository where/mutation contract', () => {
  beforeAll(async () => {
    for (const [i, username] of [
      `wc_${runId}_a%b`,
      `wc_${runId}_axb`,
      `wc_${runId}_c`,
    ].entries()) {
      const id = await generateSnowflakeId();
      ids.push(id);
      await db.insert(users).values({
        id,
        username,
        isActor: false,
        reputationPoints: 10,
        updatedAt: i === 0 ? fixedDate : new Date(),
      });
    }
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.id, ids));
  });

  it('matches Date equality instead of dropping the condition', async () => {
    const rows = await db.user.findMany({
      where: { id: { in: ids }, updatedAt: fixedDate },
    });
    expect(rows.map((r) => r.id)).toEqual([ids[0]!]);
  });

  it('treats an empty OR as matching nothing', async () => {
    const rows = await db.user.findMany({
      where: { id: { in: ids }, OR: [] },
    });
    expect(rows).toHaveLength(0);
  });

  it('rejects unknown fields and operators instead of ignoring them', async () => {
    await expect(
      db.user.updateMany({
        where: { notAColumn: 'x' } as never,
        data: { reputationPoints: 0 },
      })
    ).rejects.toThrow('Unknown where field');
    await expect(
      db.user.findMany({
        where: { id: { search: 'x' } } as never,
      })
    ).rejects.toThrow('Unsupported where operator');
  });

  it('applies every condition in a NOT array', async () => {
    const rows = await db.user.findMany({
      where: { id: { in: ids }, NOT: [{ id: ids[0] }, { id: ids[1] }] },
    });
    expect(rows.map((r) => r.id)).toEqual([ids[2]!]);
  });

  it('matches LIKE wildcards literally', async () => {
    const rows = await db.user.findMany({
      where: { username: { contains: `${runId}_a%b` } },
    });
    expect(rows.map((r) => r.id)).toEqual([ids[0]!]);
  });

  it('applies increment in updateMany and counts real inserts', async () => {
    const updated = await db.user.updateMany({
      where: { id: { in: ids } },
      data: { reputationPoints: { increment: 5 } },
    });
    expect(updated.count).toBe(3);
    const rows = await db.user.findMany({ where: { id: { in: ids } } });
    expect(rows.every((r) => r.reputationPoints === 15)).toBe(true);

    const duplicate = await db.user.createMany({
      data: [
        {
          id: ids[0]!,
          username: `wc_${runId}_dup`,
          isActor: false,
          updatedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    expect(duplicate.count).toBe(0);
  });
});
