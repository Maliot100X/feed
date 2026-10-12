/**
 * Steward email bridge: when two different Steward identities present the
 * same email concurrently, exactly one may be linked to the existing unlinked
 * user, and the existing link must never be overwritten.
 *
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { authenticate } from '@feed/api';
import { db, eq, inArray, or, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';
import { NextRequest } from 'next/server';

const SECRET = 'integration-steward-secret';
const runId = crypto.randomUUID().slice(0, 8);
const email = `bridge-${runId}@example.com`;
const stewardA = `steward-a-${runId}`;
const stewardB = `steward-b-${runId}`;
let existingUserId: string;
const previousSecret = process.env.STEWARD_JWT_SECRET;

async function request(stewardUserId: string): Promise<NextRequest> {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    userId: stewardUserId,
    email,
    iss: 'steward',
    exp: Math.floor(Date.now() / 1000) + 300,
  })}`;
  const signature = createHmac('sha256', SECRET)
    .update(unsigned)
    .digest('base64url');
  const token = `${unsigned}.${signature}`;
  return new NextRequest('http://localhost/api/test', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('Steward email bridge linking', () => {
  beforeAll(async () => {
    process.env.STEWARD_JWT_SECRET = SECRET;
    existingUserId = await generateSnowflakeId();
    await db.insert(users).values({
      id: existingUserId,
      username: `bridge_${runId}`,
      email,
      isActor: false,
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await db
      .delete(users)
      .where(
        or(
          eq(users.id, existingUserId),
          inArray(users.stewardId, [stewardA, stewardB])
        )
      );
    if (previousSecret === undefined) delete process.env.STEWARD_JWT_SECRET;
    else process.env.STEWARD_JWT_SECRET = previousSecret;
  });

  it('links exactly one identity and never authenticates both as the same user', async () => {
    const [a, b] = await Promise.all([
      authenticate(await request(stewardA)),
      authenticate(await request(stewardB)),
    ]);

    const [row] = await db
      .select({ stewardId: users.stewardId })
      .from(users)
      .where(eq(users.id, existingUserId));
    const winner = row?.stewardId;
    expect([stewardA, stewardB]).toContain(winner ?? '');

    const winnerResult = winner === stewardA ? a : b;
    const loserResult = winner === stewardA ? b : a;
    expect(winnerResult.dbUserId).toBe(existingUserId);
    expect(loserResult.dbUserId).not.toBe(existingUserId);

    // A later login by the winner keeps resolving to the linked user, and the
    // link is not overwritten by the loser logging in again.
    const loserSteward = winner === stewardA ? stewardB : stewardA;
    const again = await authenticate(await request(loserSteward));
    expect(again.dbUserId).toBe(loserResult.dbUserId);
    const [after] = await db
      .select({ stewardId: users.stewardId })
      .from(users)
      .where(eq(users.id, existingUserId));
    expect(after?.stewardId).toBe(winner);
  });
});
