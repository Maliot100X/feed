/**
 * Validation for DISPATCH_TO_AGENTS parameters (kept free of runtime service
 * imports so it can be unit tested in isolation).
 */

/** Maximum agents per multi-dispatch (resource bound). */
export const MAX_DISPATCHES = 5;

export interface AgentDispatch {
  agentId: string;
  command: string;
}

/**
 * Validate the full dispatch list. Any malformed entry, duplicate agent or a
 * list longer than MAX_DISPATCHES rejects the whole request rather than
 * silently dropping or truncating requested work.
 */
export function validateDispatches(
  raw: unknown
): { ok: true; dispatches: AgentDispatch[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'dispatches must be a non-empty array' };
  }
  if (raw.length > MAX_DISPATCHES) {
    return {
      ok: false,
      error: `At most ${MAX_DISPATCHES} agents can be dispatched at once (got ${raw.length})`,
    };
  }
  const dispatches: AgentDispatch[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    const agentId =
      entry && typeof entry === 'object' && 'agentId' in entry
        ? entry.agentId
        : undefined;
    const command =
      entry && typeof entry === 'object' && 'command' in entry
        ? entry.command
        : undefined;
    if (
      typeof agentId !== 'string' ||
      !agentId.trim() ||
      typeof command !== 'string' ||
      !command.trim()
    ) {
      return {
        ok: false,
        error: `Dispatch #${i + 1} needs a non-empty agentId and command`,
      };
    }
    if (seen.has(agentId.trim())) {
      return {
        ok: false,
        error: `Agent ${agentId.trim()} appears more than once; combine its commands`,
      };
    }
    seen.add(agentId.trim());
    dispatches.push({ agentId: agentId.trim(), command: command.trim() });
  }
  return { ok: true, dispatches };
}
