#!/usr/bin/env bun
/** Capture real HTTP A2A provider inputs and rendered prompt context on a local audit server. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';
import { $disconnect } from '@feed/db';
import { initializeAgentA2AClient } from '../packages/agents/src/plugins/feed/integration-a2a-sdk';
import { marketsProvider } from '../packages/agents/src/plugins/feed/providers/markets';

const agentId = process.argv[2];
if (!agentId) throw new Error('Agent ID is required');
const endpoint = new URL(process.env.FEED_A2A_ENDPOINT || '');
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname))
  throw new Error('Local A2A audit endpoint required');
if (process.env.FEED_A2A_TRANSPORT !== 'http')
  throw new Error('Explicit HTTP transport required');
const output = path.resolve('runs', `a2a-context-audit-${Date.now()}`);
mkdirSync(output, { recursive: true });
const originalFetch = globalThis.fetch;
const requests: Array<{
  url: string;
  request: string | null;
  status: number;
  response: string;
}> = [];
const captureFetch: typeof fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const response = await originalFetch(input, init);
    requests.push({
      url: String(input),
      request: typeof init?.body === 'string' ? init.body : null,
      status: response.status,
      response: await response.clone().text(),
    });
    return response;
  },
  { preconnect: originalFetch.preconnect }
);
globalThis.fetch = captureFetch;
try {
  const client = await initializeAgentA2AClient(agentId);
  if (!client) throw new Error('A2A client unavailable');
  const balance = await client.getBalance();
  const context = await marketsProvider.get(
    { a2aClient: client } as unknown as IAgentRuntime,
    {} as Memory,
    {} as State
  );
  if (!context.text?.includes('ticker:'))
    throw new Error('Market prompt missing executable tickers');
  writeFileSync(
    path.join(output, 'context.json'),
    JSON.stringify({ agentId, balance, context }, null, 2)
  );
  console.log(
    JSON.stringify({
      output,
      requestCount: requests.length,
      contextLength: context.text.length,
    })
  );
} finally {
  globalThis.fetch = originalFetch;
  writeFileSync(
    path.join(output, 'requests.json'),
    JSON.stringify(requests, null, 2)
  );
  await $disconnect();
}
