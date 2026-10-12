import { expect, test } from 'bun:test';
import { DistributedLockService as DatabaseLocks } from '../../api/src/services/distributed-lock-service';
import { DistributedLockService as MemoryLocks } from '../../engine/src/services/distributed-lock-service';

for (const [name, locks] of [
  ['database', DatabaseLocks],
  ['memory', MemoryLocks],
] as const) {
  test(`${name} lock renews for its owner and excludes other owners`, async () => {
    const params = {
      lockId: `agent-audit-${crypto.randomUUID()}`,
      durationMs: 60000,
      operation: 'audit-renewal',
      processId: 'audit-owner',
    };
    try {
      expect(await locks.acquireLock(params)).toBe(true);
      expect(await locks.acquireLock(params)).toBe(true);
      expect(
        await locks.acquireLock({ ...params, processId: 'other-owner' })
      ).toBe(false);
      await locks.releaseLock(params.lockId, 'other-owner');
      expect(
        await locks.acquireLock({ ...params, processId: 'other-owner' })
      ).toBe(false);
    } finally {
      await locks.releaseLock(params.lockId, params.processId);
    }
    expect(
      await locks.acquireLock({ ...params, processId: 'other-owner' })
    ).toBe(true);
    await locks.releaseLock(params.lockId, 'other-owner');
  });
}

test('renewal cannot reclaim an expired or differently owned lease', async () => {
  const lockId = `agent-audit-expired-${crypto.randomUUID()}`;
  const { db, eq, generationLocks } = await import('@feed/db');
  try {
    expect(
      await DatabaseLocks.acquireLock({
        lockId,
        processId: 'owner',
        operation: 'audit',
        durationMs: 60000,
      })
    ).toBe(true);
    expect(await DatabaseLocks.renewLock(lockId, 'stranger', 60000)).toBe(
      false
    );
    await db
      .update(generationLocks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(generationLocks.id, lockId));
    expect(await DatabaseLocks.renewLock(lockId, 'owner', 60000)).toBe(false);
  } finally {
    await DatabaseLocks.releaseLock(lockId, 'owner');
  }
});

test('deadline waits for in-flight work and prevents its next action before releasing the lease', async () => {
  const {
    acquireAgentLock,
    releaseAgentLock,
    checkAgentLock,
    withAgentExecutionLease,
  } = await import('../../agents/src/services/agent-lock-service');
  const agentId = `lease-audit-${crypto.randomUUID()}`;
  const owner = 'deadline-owner';
  const deadlineError = new Error('execution deadline');
  let settled = false;
  let actionExecuted = false;
  try {
    expect(await acquireAgentLock(agentId, owner)).toBe(true);
    const result = withAgentExecutionLease(
      agentId,
      owner,
      async (signal) => {
        await Bun.sleep(40);
        expect((await checkAgentLock(agentId))?.lockedBy).toBe(owner);
        settled = true;
        signal.throwIfAborted();
        actionExecuted = true;
      },
      { timeoutMs: 5, timeoutError: deadlineError }
    );
    await expect(result).rejects.toBe(deadlineError);
    expect(settled).toBe(true);
    expect(actionExecuted).toBe(false);
    expect((await checkAgentLock(agentId))?.lockedBy).toBe(owner);
  } finally {
    await releaseAgentLock(agentId, owner);
  }
});
