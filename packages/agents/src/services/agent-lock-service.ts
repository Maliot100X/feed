/**
 * Agent Lock Service
 *
 * Per-agent distributed locks to prevent concurrent agent tick execution.
 * Each agent gets its own lock to prevent double-ticking or stacking ticks.
 *
 * @remarks
 * Features:
 * - Per-agent locking (independent locks for each agent)
 * - Database-based locking (works across multiple servers)
 * - Automatic stale lock recovery (10 minutes expiry)
 * - Simple acquire/release pattern
 * - No external dependencies (uses Drizzle)
 * - Serverless-safe (uses timestamp + random bytes instead of process.pid)
 *
 * @example
 * ```typescript
 * const processId = createAgentLockOwner();
 * if (!await acquireAgentLock(agentId, processId)) {
 *   return; // Skip this agent, still running from previous tick
 * }
 *
 * try {
 *   await runAgentTick(agentId);
 * } finally {
 *   await releaseAgentLock(agentId, processId);
 * }
 * ```
 *
 * @packageDocumentation
 */

import { DistributedLockService } from '@feed/api';
import { randomBytes } from 'crypto';

/**
 * Lock duration for agent tick operations.
 *
 * @remarks
 * - Default: 10 minutes (600,000ms)
 * - Configurable via AGENT_LOCK_DURATION_MS environment variable
 * - If an agent tick fails mid-execution without releasing the lock,
 *   the lock automatically expires after this duration
 * - This prevents stuck agents from blocking subsequent ticks indefinitely
 * - Set below function timeout (13.3 minutes) to ensure proper recovery
 */
export const AGENT_LOCK_DURATION_MS =
  process.env.AGENT_LOCK_DURATION_MS === undefined
    ? 10 * 60 * 1000
    : Number(process.env.AGENT_LOCK_DURATION_MS);
if (
  !Number.isSafeInteger(AGENT_LOCK_DURATION_MS) ||
  AGENT_LOCK_DURATION_MS <= 0
) {
  throw new Error('AGENT_LOCK_DURATION_MS must be a positive integer');
}

function getAgentLockId(agentId: string): string {
  return `agent-tick-${agentId}`;
}

/** Create a unique, serverless-safe lock owner token. */
export function createAgentLockOwner(): string {
  return `serverless-${Date.now()}-${randomBytes(8).toString('hex')}`;
}

/**
 * Acquire the per-agent tick lease for `processId`.
 * The caller must keep `processId` to release the lease later; an owner token
 * is required so a lease can never be acquired without a way to release it.
 */
export async function acquireAgentLock(
  agentId: string,
  processId: string
): Promise<boolean> {
  if (!processId) throw new Error('acquireAgentLock requires a processId');
  const lockId = getAgentLockId(agentId);

  return DistributedLockService.acquireLock({
    lockId,
    durationMs: AGENT_LOCK_DURATION_MS,
    operation: 'agent-tick',
    processId,
  });
}

export async function releaseAgentLock(
  agentId: string,
  processId: string
): Promise<void> {
  if (!processId) throw new Error('releaseAgentLock requires a processId');
  const lockId = getAgentLockId(agentId);
  return DistributedLockService.releaseLock(lockId, processId);
}

export async function checkAgentLock(agentId: string) {
  const lockId = getAgentLockId(agentId);
  return DistributedLockService.checkLock(lockId);
}

/** Keep an acquired lease until work settles; cancellation prevents subsequent actions. */
export async function withAgentExecutionLease<T>(
  agentId: string,
  processId: string,
  work: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; timeoutError?: Error } = {}
): Promise<T> {
  const controller = new AbortController();
  const renew = async () => {
    if (
      !(await DistributedLockService.renewLock(
        getAgentLockId(agentId),
        processId,
        AGENT_LOCK_DURATION_MS
      ))
    ) {
      throw new Error(`Agent ${agentId} lost its execution lease`);
    }
  };
  await renew();
  let renewal: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    timer = setTimeout(
      () => {
        renewal = renew()
          .catch((error: Error) => controller.abort(error))
          .then(() => {
            if (!stopped && !controller.signal.aborted) schedule();
          });
      },
      Math.max(1, Math.floor(AGENT_LOCK_DURATION_MS / 3))
    );
  };
  schedule();
  const deadline =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          controller.abort(
            options.timeoutError ??
              new Error(`Agent ${agentId} execution deadline exceeded`)
          );
        }, options.timeoutMs);
  try {
    const result = await work(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (deadline) clearTimeout(deadline);
    await renewal;
  }
}
