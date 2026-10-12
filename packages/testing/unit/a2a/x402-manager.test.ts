/**
 * X402Manager verification binds a transaction to exactly one payment
 * request and to the request's sender, recipient and full amount.
 * Uses an in-memory chain reader; no network access.
 */

import { describe, expect, it } from 'bun:test';
import {
  type ChainReader,
  X402Manager,
} from '../../../a2a/src/payments/x402-manager';

const PAYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const TREASURY = '0x3333333333333333333333333333333333333333';
const AMOUNT = 10n ** 15n; // 0.001 ETH

interface FakeTx {
  from: string;
  to: string | null;
  value: bigint;
  status: number;
  blockTimestamp: number;
}

function hash(n: number): string {
  return `0x${n.toString(16).padStart(64, '0')}`;
}

function createManager(txs: Map<string, FakeTx>): X402Manager {
  const provider: ChainReader = {
    getTransaction: async (h) => txs.get(h) ?? null,
    getTransactionReceipt: async (h) => {
      const tx = txs.get(h);
      return tx ? { status: tx.status, blockNumber: Number(BigInt(h)) } : null;
    },
    getBlock: async (blockNumber) => {
      const tx = txs.get(hash(blockNumber));
      return tx ? { timestamp: tx.blockTimestamp } : null;
    },
  };
  return new X402Manager({ rpcUrl: 'http://unused.invalid', provider });
}

const now = () => Math.floor(Date.now() / 1000);

function goodTx(overrides: Partial<FakeTx> = {}): FakeTx {
  return {
    from: PAYER,
    to: TREASURY,
    value: AMOUNT,
    status: 1,
    blockTimestamp: now(),
    ...overrides,
  };
}

async function verify(manager: X402Manager, requestId: string, txHash: string) {
  return manager.verifyPayment({
    requestId,
    txHash,
    from: PAYER,
    to: TREASURY,
    amount: AMOUNT.toString(),
    timestamp: Date.now(),
    confirmed: true,
  });
}

describe('X402Manager.verifyPayment', () => {
  it('verifies a matching payment', async () => {
    const txs = new Map([[hash(1), goodTx()]]);
    const manager = createManager(txs);
    const request = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    expect(await verify(manager, request.requestId, hash(1))).toEqual({
      verified: true,
    });
  });

  it('rejects a transaction sent by someone else', async () => {
    const txs = new Map([[hash(2), goodTx({ from: OTHER })]]);
    const manager = createManager(txs);
    const request = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    const result = await verify(manager, request.requestId, hash(2));
    expect(result.verified).toBe(false);
    expect(result.error).toContain('Sender mismatch');
  });

  it('rejects the wrong recipient and any underpayment', async () => {
    const txs = new Map([
      [hash(3), goodTx({ to: OTHER })],
      [hash(4), goodTx({ value: AMOUNT - 1n })],
    ]);
    const manager = createManager(txs);
    const r1 = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    const r2 = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    expect((await verify(manager, r1.requestId, hash(3))).error).toContain(
      'Recipient mismatch'
    );
    expect((await verify(manager, r2.requestId, hash(4))).error).toContain(
      'Insufficient payment'
    );
  });

  it('does not let one transaction satisfy two requests', async () => {
    const txs = new Map([[hash(5), goodTx()]]);
    const manager = createManager(txs);
    const a = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    const b = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    const results = await Promise.all([
      verify(manager, a.requestId, hash(5)),
      verify(manager, b.requestId, hash(5)),
    ]);
    expect(results.filter((r) => r.verified)).toHaveLength(1);
    // Retrying the winning request with the same transaction is idempotent.
    const winner = results[0]!.verified ? a : b;
    expect((await verify(manager, winner.requestId, hash(5))).verified).toBe(
      true
    );
  });

  it('keeps a verified request bound to its transaction', async () => {
    const txs = new Map([
      [hash(6), goodTx()],
      [hash(7), goodTx()],
    ]);
    const manager = createManager(txs);
    const request = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    expect((await verify(manager, request.requestId, hash(6))).verified).toBe(
      true
    );
    const other = await verify(manager, request.requestId, hash(7));
    expect(other.verified).toBe(false);
    expect(other.error).toContain('different transaction');
  });

  it('rejects a transaction mined before the request was created', async () => {
    const txs = new Map([[hash(8), goodTx({ blockTimestamp: now() - 3600 })]]);
    const manager = createManager(txs);
    const request = await manager.createPaymentRequest(
      PAYER,
      TREASURY,
      AMOUNT.toString(),
      'test'
    );
    const result = await verify(manager, request.requestId, hash(8));
    expect(result.verified).toBe(false);
    expect(result.error).toContain('predates');
  });
});
