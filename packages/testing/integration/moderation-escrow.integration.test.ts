/**
 * Moderation escrow transitions and escrow-backed appeals.
 *
 * Chain reads are served by an in-memory ChainReader; no network calls.
 * Requires DATABASE_URL pointing at a disposable database with schema applied.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import path from 'node:path';
import { db, eq, inArray, moderationEscrows, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';
import {
  type ChainReader,
  X402Manager,
} from '../../a2a/src/payments/x402-manager';

const successfulTxs = new Set<string>();
const chain: ChainReader = {
  getTransaction: async () => null,
  getTransactionReceipt: async (h) =>
    successfulTxs.has(h) ? { status: 1, blockNumber: 1 } : null,
  getBlock: async () => ({ timestamp: Math.floor(Date.now() / 1000) }),
};

const createdUsers: string[] = [];
const createdEscrows: string[] = [];
let escrowService: typeof import('../../a2a/src/payments/escrow-service');
let handleAppealBanWithEscrow: typeof import('../../a2a/src/handlers/escrow-handlers').handleAppealBanWithEscrow;

function txHash(): string {
  return `0x${crypto.randomUUID().replace(/-/g, '').padEnd(64, '0')}`;
}

async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {}
): Promise<string> {
  const id = await generateSnowflakeId();
  await db.insert(users).values({
    id,
    username: `esc_${id.slice(-10)}`,
    isActor: false,
    updatedAt: new Date(),
    ...overrides,
  });
  createdUsers.push(id);
  return id;
}

async function createEscrow(
  overrides: Partial<typeof moderationEscrows.$inferInsert>
): Promise<string> {
  const id = await generateSnowflakeId();
  await db.insert(moderationEscrows).values({
    id,
    recipientId: 'recipient',
    adminId: 'admin',
    amountUSD: '10.00',
    amountWei: '10000000000000000',
    status: 'pending',
    paymentRequestId: `req-${id}`,
    expiresAt: new Date(Date.now() + 60_000),
    updatedAt: new Date(),
    ...overrides,
  });
  createdEscrows.push(id);
  return id;
}

async function escrowStatus(id: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: moderationEscrows.status })
    .from(moderationEscrows)
    .where(eq(moderationEscrows.id, id));
  return row?.status;
}

describe('moderation escrow', () => {
  beforeAll(async () => {
    const sharedManagerPath = path.resolve(
      import.meta.dir,
      '../../a2a/src/payments/shared-manager.ts'
    );
    const actual = await import(sharedManagerPath);
    mock.module(sharedManagerPath, () => ({
      ...actual,
      getSharedX402Manager: async () =>
        new X402Manager({ rpcUrl: 'http://unused.invalid', provider: chain }),
    }));
    escrowService = await import('../../a2a/src/payments/escrow-service');
    ({ handleAppealBanWithEscrow } = await import(
      '../../a2a/src/handlers/escrow-handlers'
    ));
  });

  afterAll(async () => {
    await db
      .delete(moderationEscrows)
      .where(inArray(moderationEscrows.id, createdEscrows));
    await db.delete(users).where(inArray(users.id, createdUsers));
    mock.restore();
  });

  it('a late verification never moves a paid escrow to expired', async () => {
    const id = await createEscrow({
      status: 'paid',
      paymentTxHash: txHash(),
      expiresAt: new Date(Date.now() - 60_000),
    });
    const result = await escrowService.verifyEscrowPayment({
      escrowId: id,
      txHash: txHash(),
      fromAddress: '0x1111111111111111111111111111111111111111',
      toAddress: '0x2222222222222222222222222222222222222222',
      amount: '1',
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_state' });
    expect(await escrowStatus(id)).toBe('paid');
  });

  it('expires a pending escrow past its deadline', async () => {
    const id = await createEscrow({
      expiresAt: new Date(Date.now() - 60_000),
    });
    const result = await escrowService.verifyEscrowPayment({
      escrowId: id,
      txHash: txHash(),
      fromAddress: '0x1111111111111111111111111111111111111111',
      toAddress: '0x2222222222222222222222222222222222222222',
      amount: '1',
    });
    expect(result).toMatchObject({ ok: false, code: 'expired' });
    expect(await escrowStatus(id)).toBe('expired');
  });

  it('requires on-chain evidence and refunds exactly once', async () => {
    const id = await createEscrow({ status: 'paid', paymentTxHash: txHash() });

    const unproven = await escrowService.refundEscrowPayment({
      escrowId: id,
      refundTxHash: txHash(),
      refundedBy: 'admin',
    });
    expect(unproven).toMatchObject({ ok: false, code: 'verification_failed' });
    expect(await escrowStatus(id)).toBe('paid');

    const [a, b] = [txHash(), txHash()];
    successfulTxs.add(a);
    successfulTxs.add(b);
    const results = await Promise.all([
      escrowService.refundEscrowPayment({
        escrowId: id,
        refundTxHash: a,
        refundedBy: 'admin',
      }),
      escrowService.refundEscrowPayment({
        escrowId: id,
        refundTxHash: b,
        refundedBy: 'admin',
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await escrowStatus(id)).toBe('refunded');
  });

  it('accepts an escrow-backed second appeal and enforces the minimum stake', async () => {
    const userId = await createUser({
      isBanned: true,
      appealCount: 1,
      appealStaked: false,
    });
    const smallTx = txHash();
    await createEscrow({
      recipientId: userId,
      status: 'paid',
      paymentTxHash: smallTx,
      amountUSD: '5.00',
    });
    const small = await handleAppealBanWithEscrow(userId, {
      jsonrpc: '2.0',
      id: 1,
      method: 'moderation.appeal_ban_with_escrow',
      params: {
        reason: 'Please review my ban again',
        escrowPaymentTxHash: smallTx,
      },
    });
    expect(small.error?.message).toContain('at least $10');

    const stakeTx = txHash();
    await createEscrow({
      recipientId: userId,
      status: 'paid',
      paymentTxHash: stakeTx,
      amountUSD: '10.00',
    });
    const ok = await handleAppealBanWithEscrow(userId, {
      jsonrpc: '2.0',
      id: 2,
      method: 'moderation.appeal_ban_with_escrow',
      params: {
        reason: 'Please review my ban again',
        escrowPaymentTxHash: stakeTx,
      },
    });
    expect(ok.error).toBeUndefined();

    const [user] = await db
      .select({
        appealCount: users.appealCount,
        appealStaked: users.appealStaked,
        appealStakeTxHash: users.appealStakeTxHash,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(user).toEqual({
      appealCount: 2,
      appealStaked: true,
      appealStakeTxHash: stakeTx,
    });
  });
});
