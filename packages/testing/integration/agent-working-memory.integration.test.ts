import { afterAll, expect, test } from 'bun:test';
import { db, inArray, worldFacts } from '@feed/db';
import { loadWorkingMemory } from '../../agents/src/plugins/feed/providers/working-memory';

const marker = `memory-audit-${crypto.randomUUID()}`;
const ids = Array.from({ length: 56 }, (_, index) => `${marker}-${index}`);
afterAll(async () => {
  await db.delete(worldFacts).where(inArray(worldFacts.id, ids));
});

test('working memory queries the owning agent even behind fifty newer agents', async () => {
  const memory = {
    recentContacts: [],
    gatheredFacts: [],
    activeThesis: 'keep exact older thesis',
    recentTradeReasoning: [],
    lastUpdated: new Date().toISOString(),
  };
  await db.insert(worldFacts).values(
    ids.map((id, index) => ({
      id,
      category: 'agent_working_memory',
      key: `agent:${id}:working_memory`,
      label: id,
      value: JSON.stringify(memory),
      source: 'context-audit',
      lastUpdated: new Date(),
      updatedAt: new Date(Date.now() + index * 1000),
    }))
  );
  expect((await loadWorkingMemory(ids[0]!)).activeThesis).toBe(
    memory.activeThesis
  );
});

test('corrupt persisted working memory fails instead of appearing empty', async () => {
  await db
    .update(worldFacts)
    .set({ value: '{"recentContacts":null}' })
    .where(inArray(worldFacts.id, [ids[0]!]));
  await expect(loadWorkingMemory(ids[0]!)).rejects.toThrow();
  expect(
    (await loadWorkingMemory(`${marker}-new-agent`)).gatheredFacts
  ).toEqual([]);
});
