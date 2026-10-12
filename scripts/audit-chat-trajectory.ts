#!/usr/bin/env bun
/** Real chat dispatch/LLM/persistence audit with isolated local input records. */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  $disconnect,
  chatParticipants,
  chats,
  db,
  eq,
  messages,
  userAgentConfigs,
  users,
} from '@feed/db';
import { agentRuntimeManager } from '../packages/agents/src/runtime/AgentRuntimeManager';
import { dispatchAgentChat } from '../packages/agents/src/services/AgentChatService';
import { closeRedis, ensureRedisReady } from '../packages/api/src/redis/client';
import { broadcastChatMessage } from '../packages/api/src/sse/event-broadcaster';
import {
  installLLMInterceptor,
  setLLMCallCallback,
  uninstallLLMInterceptor,
} from '../packages/engine/src/dag-trace';

const database = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(database.hostname))
  throw new Error('Local audit DB required');
const httpMode = process.argv.includes('--http');
const routeMode = httpMode || process.argv.includes('--route');
const suffix = Date.now().toString();
const ownerId = `chat-audit-owner-${suffix}`;
const agentId = `chat-audit-agent-${suffix}`;
const chatId = `chat-audit-room-${suffix}`;
const output = path.resolve(
  'runs',
  `${routeMode ? 'chat-route-audit' : 'chat-audit'}-${suffix}`
);
mkdirSync(output, { recursive: true });
installLLMInterceptor();
let callCount = 0;
setLLMCallCallback((call) => {
  appendFileSync(
    path.join(output, 'llm-calls.jsonl'),
    JSON.stringify(call) + '\n'
  );
  callCount++;
});
try {
  if (!(await ensureRedisReady()))
    throw new Error('Local Redis required for broadcast verification');
  await db.insert(users).values([
    {
      id: ownerId,
      username: `audit_owner_${suffix}`,
      displayName: 'Audit Owner',
      isTest: true,
      updatedAt: new Date(),
    },
    {
      id: agentId,
      username: `audit_agent_${suffix}`,
      displayName: 'Audit Agent',
      isAgent: true,
      managedBy: ownerId,
      isTest: true,
      virtualBalance: '1234.56',
      lifetimePnL: '0',
      updatedAt: new Date(),
    },
  ]);
  await db.insert(userAgentConfigs).values({
    id: `${agentId}-config`,
    userId: agentId,
    systemPrompt:
      'Use the supplied conversation and portfolio. Be concise and factual. Do not trade or send money during this audit.',
    personality: 'Careful and direct',
    updatedAt: new Date(),
  });
  await db.insert(chats).values({
    id: chatId,
    name: 'Context audit',
    isGroup: true,
    createdBy: ownerId,
    updatedAt: new Date(),
  });
  await db.insert(chatParticipants).values(
    [ownerId, agentId].map((id) => ({
      id: `${chatId}-${id}`,
      chatId,
      userId: id,
    }))
  );
  await db.insert(messages).values({
    id: `${chatId}-history`,
    chatId,
    senderId: ownerId,
    targetIds: [agentId],
    content:
      'The code phrase for this conversation is circuit-amber-47. Keep that phrase in context for my next message.',
    createdAt: new Date(Date.now() - 60000),
  });
  const command =
    'State the code phrase from my previous message and your available balance. Do not trade, send funds, or message anyone else.';
  await db.insert(messages).values({
    id: `${chatId}-request`,
    chatId,
    senderId: ownerId,
    targetIds: [agentId],
    content: command,
    createdAt: new Date(),
  });
  const broadcasts: string[] = [];
  let result: { success: boolean; response: string };
  if (routeMode) {
    await db.agentMessage.create({
      data: {
        id: `${agentId}-history`,
        agentUserId: agentId,
        role: 'user',
        content:
          'The code phrase for this conversation is circuit-amber-47. Keep it for my next message.',
        createdAt: new Date(Date.now() - 60000),
      },
    });
    const requestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer steward:test:${ownerId}`,
      },
      body: JSON.stringify({ message: command, usePro: false }),
    };
    let response: Response;
    if (httpMode) {
      const base = new URL(
        process.env.TEST_BASE_URL || 'http://127.0.0.1:3201'
      );
      if (!['localhost', '127.0.0.1'].includes(base.hostname))
        throw new Error('Local audit server required');
      response = await fetch(new URL(`/api/agents/${agentId}/chat`, base), {
        ...requestInit,
        signal: AbortSignal.timeout(600000),
      });
    } else {
      const { NextRequest } = await import('next/server');
      const { POST } = await import(
        '../apps/web/src/app/api/agents/[agentId]/chat/route'
      );
      response = await POST(
        new NextRequest(
          `http://localhost/api/agents/${agentId}/chat`,
          requestInit
        ),
        { params: Promise.resolve({ agentId }) }
      );
    }
    const body = await response.json();
    writeFileSync(
      path.join(output, 'http-response.json'),
      JSON.stringify({ status: response.status, body }, null, 2)
    );
    if (!response.ok || typeof body.response !== 'string')
      throw new Error(`Chat route failed with status ${response.status}`);
    result = { success: body.success === true, response: body.response };
  } else {
    result = await dispatchAgentChat({
      agentId,
      ownerId,
      teamChatId: chatId,
      ownerName: 'Audit Owner',
      message: command,
      broadcastFn: async (id, message) => {
        await broadcastChatMessage(id, message);
        broadcasts.push(message.id);
      },
    });
  }
  const stored = routeMode
    ? await db.agentMessage.findMany({
        where: { agentUserId: agentId, role: 'assistant' },
      })
    : await db.select().from(messages).where(eq(messages.senderId, agentId));
  const summary = {
    result,
    callCount,
    captureLocation: httpMode
      ? 'Server DEBUG_SAVE_PROMPTS files; client interceptor does not capture remote process calls'
      : 'llm-calls.jsonl',
    storedResponses: stored.map((message) => ({
      id: message.id,
      content: message.content,
    })),
    broadcasts,
  };
  writeFileSync(
    path.join(output, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );
  if (
    !result.success ||
    !result.response.includes('circuit-amber-47') ||
    !/1,?234\.56/.test(result.response) ||
    stored.length !== 1
  )
    throw new Error(
      'Chat context acceptance failed; inspect summary and exact calls'
    );
  console.log(JSON.stringify({ output, ...summary }));
} finally {
  await agentRuntimeManager.clearRuntime(agentId);
  uninstallLLMInterceptor();
  await closeRedis();
  await $disconnect();
}
