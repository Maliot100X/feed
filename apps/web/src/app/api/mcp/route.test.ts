import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const handleMock = mock(
  async (request: { id: string | number; method: string }) => ({
    jsonrpc: '2.0',
    id: request.id,
    result: { ok: true },
  })
);

const apiModulePath = new URL(
  '../../../../../../packages/api/src/index.ts',
  import.meta.url
).pathname;
const apiModuleFactory = () => ({
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
});
const mcpModulePath = new URL(
  '../../../../../../packages/mcp/src/index.ts',
  import.meta.url
).pathname;
const mcpModuleFactory = () => ({
  getMCPServerInfo: () => ({ name: 'feed', version: '1' }),
  getServerCapabilities: () => ({}),
  MCP_PROTOCOL_VERSIONS: ['2025-06-18'],
  MCPRequestHandler: class {
    handle = handleMock;
  },
});

mock.module('@feed/api', apiModuleFactory);
mock.module(apiModulePath, apiModuleFactory);
mock.module('@feed/mcp', mcpModuleFactory);
mock.module(mcpModulePath, mcpModuleFactory);
mock.module('@/lib/api/check-api-key', () => ({
  checkApiKey: async () => ({
    authResult: { authenticated: true, authMethod: 'server-key' },
  }),
}));

function post(body: string): NextRequest {
  return new NextRequest('https://feed.example/api/mcp', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/mcp', () => {
  beforeEach(() => {
    handleMock.mockClear();
  });

  it('returns -32700 for malformed JSON', async () => {
    const { POST } = await import('./route');
    const response = await POST(post('{not json'));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it.each([
    ['null', 'null'],
    ['primitive', '42'],
    ['batch array', '[{"jsonrpc":"2.0","method":"ping","id":1}]'],
    ['missing method', '{"jsonrpc":"2.0","id":1}'],
    ['wrong version', '{"jsonrpc":"1.0","method":"ping","id":1}'],
    ['object id', '{"jsonrpc":"2.0","method":"ping","id":{}}'],
  ])('returns -32600 for %s', async (_label, raw) => {
    const { POST } = await import('./route');
    const response = await POST(post(raw));
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: number };
      id: null;
    };
    expect(body.error.code).toBe(-32600);
    expect(body.id).toBeNull();
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('acknowledges notifications with 202 and no body', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      post('{"jsonrpc":"2.0","method":"notifications/initialized"}')
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('delegates valid requests to the MCP handler', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      post('{"jsonrpc":"2.0","method":"tools/list","id":7}')
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: number };
    expect(body.id).toBe(7);
    expect(handleMock).toHaveBeenCalledTimes(1);
  });
});
