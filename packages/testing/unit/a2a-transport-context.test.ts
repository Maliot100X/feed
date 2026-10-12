import { afterAll, expect, test } from 'bun:test';
import { A2AClient } from '@a2a-js/sdk/client';
import { feedAgentCard } from '../../a2a/src/feed-agent-card';
import { FeedA2AClient } from '../../agents/src/plugins/feed/integration-a2a-sdk';
import type { JsonValue } from '../../agents/src/types/common';

let result: JsonValue = {};
let rpcError = false;
let pollResult: JsonValue | undefined;
const requests: Array<{
  method: string;
  params: {
    message?: {
      contextId?: string;
      parts: Array<{ data: { operation: string } }>;
    };
  };
}> = [];
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const body = await request.json();
    requests.push(body);
    return Response.json(
      rpcError
        ? {
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32000, message: 'Required data unavailable' },
          }
        : {
            jsonrpc: '2.0',
            id: body.id,
            result: body.method === 'tasks/get' ? pollResult : result,
          }
    );
  },
});
const savedTransport = process.env.FEED_A2A_TRANSPORT;
process.env.FEED_A2A_TRANSPORT = 'http';
const sdk = new A2AClient({ ...feedAgentCard, url: `${server.url}api/a2a` });
const client = new FeedA2AClient(sdk, 'exact-agent-id', {
  agentUserId: 'exact-agent-id',
  displayName: 'Agent',
  cachedAt: Date.now(),
});
afterAll(() => {
  server.stop(true);
  if (savedTransport === undefined) delete process.env.FEED_A2A_TRANSPORT;
  else process.env.FEED_A2A_TRANSPORT = savedTransport;
});

test('HTTP transport preserves account identity and canonical trade operation', async () => {
  result = {
    kind: 'task',
    id: 'task-1',
    contextId: 'exact-agent-id',
    status: { state: 'completed' },
    artifacts: [
      {
        artifactId: 'result',
        parts: [{ kind: 'data', data: { success: true } }],
      },
    ],
  };
  const before = requests.length;
  expect(await client.buyShares('market-id', 'YES', 10)).toEqual({
    success: true,
  });
  expect(requests.length - before).toBe(1);
  expect(requests.at(-1)?.params.message).toMatchObject({
    contextId: 'exact-agent-id',
    parts: [
      {
        data: {
          operation: 'markets.buy_shares',
          params: { marketId: 'market-id', outcome: 'YES', amount: 10 },
        },
      },
    ],
  });
});

test('completed response without data and RPC failures are never empty success', async () => {
  result = {
    kind: 'task',
    id: 'task-2',
    contextId: 'exact-agent-id',
    status: { state: 'completed' },
  };
  await expect(client.getBalance()).rejects.toThrow('missing required data');
  rpcError = true;
  try {
    await expect(client.getBalance()).rejects.toThrow(
      'Required data unavailable'
    );
  } finally {
    rpcError = false;
  }
});

test('unknown actions and transports fail before making any request', async () => {
  const before = requests.length;
  await expect(client.request('a2a.notAnOperation')).rejects.toThrow(
    'Unsupported A2A action'
  );
  process.env.FEED_A2A_TRANSPORT = 'typo';
  try {
    await expect(client.getBalance()).rejects.toThrow(
      'Invalid FEED_A2A_TRANSPORT'
    );
  } finally {
    process.env.FEED_A2A_TRANSPORT = 'http';
  }
  expect(requests.length).toBe(before);
});

test('polling reads the SDK task result directly and preserves its data', async () => {
  result = {
    kind: 'task',
    id: 'task-pending',
    contextId: 'exact-agent-id',
    status: { state: 'working' },
  };
  pollResult = {
    kind: 'task',
    id: 'task-pending',
    contextId: 'exact-agent-id',
    status: { state: 'completed' },
    artifacts: [
      {
        artifactId: 'result',
        parts: [{ kind: 'data', data: { balance: 1234.56 } }],
      },
    ],
  };
  expect(await client.getBalance()).toEqual({ balance: 1234.56 });
  expect(requests.at(-1)?.method).toBe('tasks/get');
});
