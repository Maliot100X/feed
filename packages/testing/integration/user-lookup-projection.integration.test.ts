/**
 * User lookup projections return exactly the selected fields, dates are Date
 * objects, and actor users are reported as actors.
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  findTargetByIdentifier,
  findUserByIdentifier,
  requireUserByIdentifier,
} from '@feed/api';
import { db, eq, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';

let userId: string;

describe('user lookup projections', () => {
  beforeAll(async () => {
    userId = await generateSnowflakeId();
    await db.insert(users).values({
      id: userId,
      username: `proj_${userId.slice(-10)}`,
      displayName: 'Projection',
      isActor: true,
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  it('returns only the requested fields', async () => {
    const picked = await findUserByIdentifier(userId, {
      id: true,
      username: true,
    });
    expect(picked).toEqual({
      id: userId,
      username: `proj_${userId.slice(-10)}`,
    });

    const required = await requireUserByIdentifier(userId, { isActor: true });
    expect(required).toEqual({ isActor: true });
  });

  it('returns Date objects for timestamp columns', async () => {
    const user = await findUserByIdentifier(userId);
    expect(user?.createdAt).toBeInstanceOf(Date);
  });

  it('reports the actual actor flag for database users', async () => {
    const target = await findTargetByIdentifier(userId);
    expect(target.targetId).toBe(userId);
    expect(target.isActor).toBe(true);
  });
});
