import type { IAgentRuntime, Memory, UUID } from '@elizaos/core';

/** Only read rooms shared by this agent and its configured admin. */
export async function getAdminHistory(
  runtime: IAgentRuntime,
  adminId: UUID
): Promise<Memory[]> {
  const roomIds = await runtime.getRoomsForParticipants([
    runtime.agentId,
    adminId,
  ]);
  if (!Array.isArray(roomIds))
    throw new Error('Admin room lookup did not return a collection');
  const histories = await Promise.all(
    roomIds.map((roomId) =>
      runtime.getMemories({ roomId, count: 15, tableName: 'messages' })
    )
  );
  const messages: Memory[] = [];
  for (const history of histories) {
    if (!Array.isArray(history))
      throw new Error('Admin history lookup did not return a collection');
    for (const message of history) {
      if (message.entityId !== adminId && message.entityId !== runtime.agentId)
        continue;
      if (!message.roomId || !roomIds.includes(message.roomId))
        throw new Error(
          'Admin history contains a message outside shared rooms'
        );
      if (
        typeof message.createdAt !== 'number' ||
        !Number.isFinite(message.createdAt)
      )
        throw new Error('Admin history message requires a timestamp');
      if (
        typeof message.content.text !== 'string' ||
        !message.content.text.trim()
      )
        throw new Error('Admin history message requires text');
      messages.push(message);
    }
  }
  return messages.sort((a, b) => a.createdAt! - b.createdAt!).slice(-15);
}
