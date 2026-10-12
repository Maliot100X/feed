import { expect, test } from 'bun:test';
import type { UUID } from '@elizaos/core';
import { FeedRuntimeAdapter } from '../../agents/src/runtime/FeedRuntimeAdapter';

test('runtime adapter retains worlds, memories and cache through the SDK batch interface', async () => {
  const adapter = new FeedRuntimeAdapter();
  const agentId = crypto.randomUUID() as UUID;
  const worldId = crypto.randomUUID() as UUID;
  const roomId = crypto.randomUUID() as UUID;
  const memoryId = crypto.randomUUID() as UUID;
  await adapter.initialize();
  await adapter.createWorlds([{ id: worldId, agentId, name: 'Audit world' }]);
  expect((await adapter.getWorldsByIds([worldId]))[0]?.name).toBe(
    'Audit world'
  );
  await adapter.createMemories([
    {
      memory: {
        id: memoryId,
        agentId,
        roomId,
        entityId: agentId,
        content: { text: 'remember this exact context' },
      },
      tableName: 'messages',
    },
  ]);
  expect((await adapter.getMemoriesByIds([memoryId]))[0]?.content.text).toBe(
    'remember this exact context'
  );
  await adapter.setCaches([{ key: 'state', value: { balance: 1234.56 } }]);
  expect((await adapter.getCaches(['state'])).get('state')).toEqual({
    balance: 1234.56,
  });
  await adapter.close();
});

test('unsupported runtime stores fail instead of acknowledging discarded writes', async () => {
  const adapter = new FeedRuntimeAdapter();
  await expect(adapter.createComponents()).rejects.toThrow('not configured');
  await expect(adapter.createRelationships()).rejects.toThrow('not configured');
});
