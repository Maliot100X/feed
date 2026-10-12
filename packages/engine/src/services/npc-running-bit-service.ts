/**
 * NPC Running Bit Service
 *
 * Provides a stable, rotating "running bit" per NPC to improve comedic continuity.
 *
 * Design goals:
 * - Stable within a time window (weekly by default, keyed by game day/week)
 * - Deterministic (seeded by actorId + period key)
 * - Stored in actorState.recentMemories for persistence + offline parity (JSON mode)
 * - Lightweight (no LLM calls)
 */

import { db, type NpcMemory } from '@feed/db';
import { generateSnowflakeId, logger } from '@feed/shared';
import { SeededRandom } from '../utils/entropy';
import { isDegenSpeaker } from '../utils/shared-utils';
import { parseMemoriesSafe } from './jsonb-validators';
import { StaticDataRegistry } from './static-data-registry';

export interface RunningBitOptions {
  /** Current timestamp (used for memory timestamps) */
  now: Date;
  /**
   * Game day (1-indexed) when available.
   * Used to compute a stable "game week" key for rotation.
   */
  currentDay?: number;
  /** Max memories to keep (mirrors npc-memory-service cap) */
  maxMemories?: number;
}

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const v = Math.floor(value);
  return v > 0 ? v : fallback;
}

function getGameWeekIndex(currentDay: number): number {
  // currentDay is 1-indexed; day 1-7 => week 0, etc.
  return Math.floor((currentDay - 1) / 7);
}

function getIsoWeekKey(date: Date): string {
  // ISO week date weeks start on Monday.
  // Adapted from common ISO week algorithm (no external deps).
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // Thursday in current week decides the year.
  const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  const year = d.getUTCFullYear();
  const week = String(weekNo).padStart(2, '0');
  return `${year}-W${week}`;
}

function buildRunningBitKey(now: Date, currentDay?: number): string {
  if (
    typeof currentDay === 'number' &&
    Number.isFinite(currentDay) &&
    currentDay >= 1
  ) {
    const weekIndex = getGameWeekIndex(currentDay);
    return `running-bit:game-week:${weekIndex}`;
  }
  return `running-bit:iso-week:${getIsoWeekKey(now)}`;
}

function hasDomain(
  actorDomains: string[] | undefined,
  domain: string
): boolean {
  return Array.isArray(actorDomains) && actorDomains.includes(domain);
}

function generateRunningBit(actorId: string, periodKey: string): string {
  const actor = StaticDataRegistry.getActor(actorId);
  const domains = actor?.domain ?? [];
  const personality = (actor?.personality ?? '').toLowerCase();

  const candidates: string[] = [];

  // General, widely applicable bits
  candidates.push(
    'You keep calling everything “signal” and nothing “noise.”',
    'You keep doing the “I’m just asking questions” thing.',
    'You keep treating the replies like they’re a hostile deposition.',
    'You keep insisting the vibes are “obviously priced in.”',
    'You keep turning every thread into an impromptu status contest.'
  );

  // Domain-specific flavor
  const degen = isDegenSpeaker({
    name: actor?.name,
    domain: domains,
    personality: actor?.personality,
    voice: actor?.voice,
    postStyle: actor?.postStyle,
    postExample: actor?.postExample,
  });

  if (degen) {
    candidates.push(
      'You keep accusing people of being exit liquidity.',
      'You keep saying “size” like it’s a personality trait.',
      'You keep bringing up risk management right after taking the riskiest stance possible.',
      'You keep acting like every disagreement is a liquidation event.'
    );
  }

  if (hasDomain(domains, 'tech') || hasDomain(domains, 'ai')) {
    candidates.push(
      'You keep asking if their argument is “benchmarkable.”',
      'You keep insisting everything is a scaling law problem.',
      'You keep treating normal life like a product roadmap.',
      'You keep using “just ship it” as a moral philosophy.'
    );
  }

  if (hasDomain(domains, 'politics')) {
    candidates.push(
      'You keep turning every reply into a campaign stump speech.',
      'You keep implying there’s a shadow committee behind everything.',
      'You keep framing mild disagreements as existential threats.'
    );
  }

  if (hasDomain(domains, 'media') || hasDomain(domains, 'journalism')) {
    candidates.push(
      'You keep saying “sources tell me” about things everyone can see.',
      'You keep writing like you’re live-tweeting your own op-ed.',
      'You keep turning every thread into a “thread” (even when it’s one sentence).'
    );
  }

  if (
    personality.includes('conspiracy') ||
    personality.includes('contrarian')
  ) {
    candidates.push(
      'You keep seeing a grand pattern where there’s clearly just chaos.',
      'You keep acting like being wrong loudly is a public service.'
    );
  }

  const rng = new SeededRandom(`${actorId}:${periodKey}`);
  return rng.pick(candidates);
}

function formatRunningBitPromptContext(bit: string): string {
  return `=== RUNNING BIT (recurring motif) ===
${bit}
Use this as an occasional callback or framing device. Do NOT force it into every reply.
====================================`;
}

const MAX_RUNNING_BIT_WRITE_ATTEMPTS = 3;

function findRunningBit(
  recentMemories: unknown,
  actorId: string,
  periodKey: string
): string | undefined {
  const memories = parseMemoriesSafe(recentMemories, { actorId });
  const existing = memories.find(
    (m) => m.type === 'running_bit' && m.eventId === periodKey
  );
  const summary = existing?.summary.trim();
  return summary ? summary : undefined;
}

/**
 * Append a running bit with an optimistic lock on updatedAt. On contention the
 * fresh row is re-read and the append retried, so concurrently written
 * memories are never overwritten; if another writer already stored a bit for
 * this period, that bit wins.
 */
async function persistRunningBit(
  initial: { id: string; recentMemories: unknown; updatedAt: Date },
  bit: string,
  periodKey: string,
  now: Date,
  maxMemories: number
): Promise<string> {
  let state = initial;
  for (let attempt = 0; attempt < MAX_RUNNING_BIT_WRITE_ATTEMPTS; attempt++) {
    const existingMemories = parseMemoriesSafe(state.recentMemories, {
      actorId: state.id,
    });
    const newMemory: NpcMemory = {
      id: await generateSnowflakeId(),
      type: 'running_bit',
      timestamp: now.toISOString(),
      summary: bit,
      eventId: periodKey,
      sentiment: 0,
    };
    const updateRes = await db.actorState.updateMany({
      where: { id: state.id, updatedAt: state.updatedAt },
      data: {
        recentMemories: [...existingMemories, newMemory].slice(-maxMemories),
        updatedAt: now,
      },
    });
    if (updateRes.count > 0) return bit;

    const fresh = await db.actorState.findFirst({
      where: { id: state.id },
      select: { id: true, recentMemories: true, updatedAt: true },
    });
    if (!fresh) return bit;
    const concurrent = findRunningBit(
      fresh.recentMemories,
      fresh.id,
      periodKey
    );
    if (concurrent) return concurrent;
    state = fresh;
  }

  logger.warn(
    'Running bit not persisted after optimistic-lock retries',
    { actorId: state.id, periodKey },
    'NpcRunningBit'
  );
  return bit;
}

/**
 * Ensure each actor has a persisted running bit memory for the current period key,
 * returning a map of actorId -> bit string (no headers).
 */
export async function ensureRunningBits(
  actorIds: string[],
  options: RunningBitOptions
): Promise<Record<string, string>> {
  const maxMemories = clampPositiveInt(options.maxMemories ?? 50, 50);
  const uniqueActorIds = [...new Set(actorIds)];
  if (uniqueActorIds.length === 0) return {};

  const now = options.now;
  const periodKey = buildRunningBitKey(now, options.currentDay);

  // Fetch actor states in one shot. Actors without an ActorState row are
  // skipped: provisioning (balances, reputation) belongs to bootstrap, not to
  // a content feature, so no financial state is minted here.
  const states = await db.actorState.findMany({
    where: { id: { in: uniqueActorIds } },
    select: { id: true, recentMemories: true, updatedAt: true },
  });

  if (states.length < uniqueActorIds.length) {
    const foundIds = new Set(states.map((s) => s.id));
    logger.warn(
      'Skipping running bits for actors without ActorState',
      { missing: uniqueActorIds.filter((id) => !foundIds.has(id)) },
      'NpcRunningBit'
    );
  }

  const result: Record<string, string> = {};

  for (const state of states) {
    const existing = findRunningBit(state.recentMemories, state.id, periodKey);
    if (existing) {
      result[state.id] = existing;
      continue;
    }

    result[state.id] = await persistRunningBit(
      state,
      generateRunningBit(state.id, periodKey),
      periodKey,
      now,
      maxMemories
    );
  }

  return result;
}

/**
 * Convert a running bit string into a prompt block.
 * Kept separate so callers can decide where/how often to inject it.
 */
export function toRunningBitPromptContext(bit: string | undefined): string {
  const trimmed = (bit ?? '').trim();
  if (!trimmed) return '';
  return formatRunningBitPromptContext(trimmed);
}
