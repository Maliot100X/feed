/**
 * Agent Working Memory Provider
 *
 * Provides persistent cross-tick memory for agents:
 * - Recent contacts (who they talked to, context, trust)
 * - Gathered facts (from group chats, DMs, feed)
 * - Active thesis/strategy
 * - Recent trade reasoning
 *
 * Stored in worldFacts table for persistence across ticks and restarts.
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import { and, db, desc, eq, worldFacts } from '@feed/db';
import { z } from 'zod';
import { logger } from '../../../shared/logger';
import { generateSnowflakeId } from '../../../shared/snowflake';

const WORKING_MEMORY_CATEGORY = 'agent_working_memory';
const MAX_CONTACTS = 10;
const MAX_FACTS = 15;
const MAX_TRADE_REASONING = 5;
const CONTACT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** A person the agent has recently interacted with */
interface RecentContact {
  userId: string;
  name: string;
  lastInteraction: string; // ISO timestamp
  context: string; // e.g., "Discussed BitcAIn alpha in VC group"
  channel: string; // e.g., "group:Alpha Traders" or "dm"
}

/** A fact the agent has gathered from conversations */
interface GatheredFact {
  fact: string;
  source: string; // e.g., "Group: Alpha Traders" or "DM: CryptoCarl"
  timestamp: string; // ISO
  usedInTrade: boolean;
}

/** Trade reasoning for consistency */
interface TradeReasoning {
  marketId: string;
  side: string;
  reasoning: string;
  timestamp: string; // ISO
}

/** Full working memory state */
export interface AgentWorkingMemoryState {
  recentContacts: RecentContact[];
  gatheredFacts: GatheredFact[];
  activeThesis: string | null;
  recentTradeReasoning: TradeReasoning[];
  lastUpdated: string; // ISO
}

const memorySchema = z.object({
  recentContacts: z.array(
    z.object({
      userId: z.string().min(1),
      name: z.string(),
      lastInteraction: z.string().datetime(),
      context: z.string(),
      channel: z.string(),
    })
  ),
  gatheredFacts: z.array(
    z.object({
      fact: z.string(),
      source: z.string(),
      timestamp: z.string().datetime(),
      usedInTrade: z.boolean(),
    })
  ),
  activeThesis: z.string().nullable(),
  recentTradeReasoning: z.array(
    z.object({
      marketId: z.string(),
      side: z.string(),
      reasoning: z.string(),
      timestamp: z.string().datetime(),
    })
  ),
  lastUpdated: z.string().datetime(),
});

async function findMemoryRow(
  key: string
): Promise<{ id: string; value: string } | undefined> {
  const [row] = await db
    .select({ id: worldFacts.id, value: worldFacts.value })
    .from(worldFacts)
    .where(
      and(
        eq(worldFacts.category, WORKING_MEMORY_CATEGORY),
        eq(worldFacts.key, key)
      )
    )
    .orderBy(desc(worldFacts.updatedAt))
    .limit(1);
  return row ? { id: row.id, value: row.value ?? '' } : undefined;
}

// TODO(D90): (category, key) has no unique constraint, so this read-then-write
// upsert can race. An atomic upsert needs a schema migration.
async function upsertMemoryRow(
  key: string,
  label: string,
  value: string
): Promise<void> {
  const existing = await findMemoryRow(key);
  const now = new Date();
  if (existing) {
    await db
      .update(worldFacts)
      .set({ label, value, lastUpdated: now, updatedAt: now })
      .where(eq(worldFacts.id, existing.id));
    return;
  }
  await db.insert(worldFacts).values({
    id: await generateSnowflakeId(),
    category: WORKING_MEMORY_CATEGORY,
    key,
    label,
    value,
    source: 'agent-working-memory',
    priority: 50,
    isActive: true,
    lastUpdated: now,
    updatedAt: now,
  });
}

function getMemoryKey(agentId: string): string {
  return `agent:${agentId}:working_memory`;
}

function createEmptyMemory(): AgentWorkingMemoryState {
  return {
    recentContacts: [],
    gatheredFacts: [],
    activeThesis: null,
    recentTradeReasoning: [],
    lastUpdated: new Date().toISOString(),
  };
}

/** Load working memory for an agent */
export async function loadWorkingMemory(
  agentId: string
): Promise<AgentWorkingMemoryState> {
  try {
    const row = await findMemoryRow(getMemoryKey(agentId));
    if (!row) return createEmptyMemory();

    const parsed = memorySchema.parse(JSON.parse(row.value));
    const now = Date.now();

    // Prune expired contacts
    const contacts = (parsed.recentContacts ?? []).filter(
      (c) => now - new Date(c.lastInteraction).getTime() < CONTACT_EXPIRY_MS
    );

    return {
      recentContacts: contacts.slice(0, MAX_CONTACTS),
      gatheredFacts: (parsed.gatheredFacts ?? []).slice(0, MAX_FACTS),
      activeThesis: parsed.activeThesis ?? null,
      recentTradeReasoning: (parsed.recentTradeReasoning ?? []).slice(
        0,
        MAX_TRADE_REASONING
      ),
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
    };
  } catch (error) {
    logger.warn(
      'Failed to load agent working memory',
      {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      },
      'WorkingMemory'
    );
    throw error;
  }
}

/** Save working memory for an agent */
export async function saveWorkingMemory(
  agentId: string,
  memory: AgentWorkingMemoryState
): Promise<void> {
  try {
    memorySchema.parse(memory);
    const updated: AgentWorkingMemoryState = {
      ...memory,
      recentContacts: memory.recentContacts.slice(0, MAX_CONTACTS),
      gatheredFacts: memory.gatheredFacts.slice(0, MAX_FACTS),
      recentTradeReasoning: memory.recentTradeReasoning.slice(
        0,
        MAX_TRADE_REASONING
      ),
      lastUpdated: new Date().toISOString(),
    };

    await upsertMemoryRow(
      getMemoryKey(agentId),
      `Working memory for agent ${agentId}`,
      JSON.stringify(updated)
    );
  } catch (error) {
    logger.warn(
      'Failed to save agent working memory',
      {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      },
      'WorkingMemory'
    );
    throw error;
  }
}

/** Add a recent contact to working memory */
export function addContact(
  memory: AgentWorkingMemoryState,
  contact: Omit<RecentContact, 'lastInteraction'>
): AgentWorkingMemoryState {
  const now = new Date().toISOString();
  // Re-contacted users move to the most-recent position so they are not
  // evicted ahead of older contacts.
  const updated = [
    { ...contact, lastInteraction: now },
    ...memory.recentContacts.filter((c) => c.userId !== contact.userId),
  ];

  return {
    ...memory,
    recentContacts: updated.slice(0, MAX_CONTACTS),
  };
}

/** Add a gathered fact to working memory */
export function addFact(
  memory: AgentWorkingMemoryState,
  fact: Omit<GatheredFact, 'timestamp' | 'usedInTrade'>
): AgentWorkingMemoryState {
  return {
    ...memory,
    gatheredFacts: [
      { ...fact, timestamp: new Date().toISOString(), usedInTrade: false },
      ...memory.gatheredFacts,
    ].slice(0, MAX_FACTS),
  };
}

/** Record trade reasoning */
export function addTradeReasoning(
  memory: AgentWorkingMemoryState,
  trade: Omit<TradeReasoning, 'timestamp'>
): AgentWorkingMemoryState {
  return {
    ...memory,
    recentTradeReasoning: [
      { ...trade, timestamp: new Date().toISOString() },
      ...memory.recentTradeReasoning,
    ].slice(0, MAX_TRADE_REASONING),
  };
}

/** Format working memory for inclusion in agent prompt */
function formatWorkingMemory(memory: AgentWorkingMemoryState): string {
  const parts: string[] = [];

  if (memory.recentContacts.length > 0) {
    parts.push('## Recent Contacts');
    for (const c of memory.recentContacts) {
      const ago = formatRelativeTime(c.lastInteraction);
      parts.push(`- **${c.name}** (${c.channel}, ${ago}): ${c.context}`);
    }
  }

  if (memory.gatheredFacts.length > 0) {
    parts.push('## Intel Gathered');
    for (const f of memory.gatheredFacts) {
      parts.push(
        `- ${f.fact} (from ${f.source}${f.usedInTrade ? ', used in trade' : ''})`
      );
    }
  }

  if (memory.activeThesis) {
    parts.push(`## Active Thesis\n${memory.activeThesis}`);
  }

  if (memory.recentTradeReasoning.length > 0) {
    parts.push('## Recent Trade Reasoning');
    for (const t of memory.recentTradeReasoning) {
      parts.push(`- ${t.side} on ${t.marketId}: ${t.reasoning}`);
    }
  }

  return parts.join('\n');
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffMs / 86400000)}d ago`;
}

/**
 * Provider: Agent Working Memory
 * Injects persistent cross-tick memory into agent context.
 */
export const workingMemoryProvider: Provider = {
  name: 'AGENT_WORKING_MEMORY',
  description:
    'Persistent cross-tick memory: recent contacts, gathered facts, active thesis, trade reasoning',

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    try {
      const agentId = runtime.agentId as string;
      const memory = await loadWorkingMemory(agentId);

      const hasContent =
        memory.recentContacts.length > 0 ||
        memory.gatheredFacts.length > 0 ||
        memory.activeThesis ||
        memory.recentTradeReasoning.length > 0;

      if (!hasContent) {
        return {
          data: { memory },
          values: { hasWorkingMemory: false },
          text: '',
        };
      }

      const formatted = formatWorkingMemory(memory);

      return {
        data: { memory },
        values: {
          hasWorkingMemory: true,
          contactCount: memory.recentContacts.length,
          factCount: memory.gatheredFacts.length,
        },
        text: `[AGENT WORKING MEMORY]\n# Your Memory (persists across ticks)\n${formatted}\n[/AGENT WORKING MEMORY]`,
      };
    } catch (error) {
      logger.warn(
        'Failed to get working memory',
        error instanceof Error ? error.message : String(error),
        'WorkingMemoryProvider'
      );
      throw error;
    }
  },
};
