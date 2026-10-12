import { describe, expect, it } from 'bun:test';
import { MCPRequestHandler } from '../../../mcp/src/handlers/mcp-request-handler';
import { MCPMethod } from '../../../mcp/src/types/mcp';

describe('MCPRequestHandler auth context', () => {
  it('does not reuse an earlier caller auth context for a later request', async () => {
    const handler = new MCPRequestHandler();

    const ping = await handler.handle(
      { jsonrpc: '2.0', id: 1, method: MCPMethod.PING },
      { apiKey: 'someone-elses-key' }
    );
    expect(ping.error).toBeUndefined();

    const call = await handler.handle({
      jsonrpc: '2.0',
      id: 2,
      method: MCPMethod.TOOLS_CALL,
      params: { name: 'get_balance', arguments: {} },
    });
    expect(call.error?.code).toBe(-32000);
    expect(call.error?.message).toBe('Authentication required');
  });
});
