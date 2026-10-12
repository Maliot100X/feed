/**
 * MCP Protocol Endpoint
 *
 * Implements JSON-RPC 2.0 Model Context Protocol for Feed.
 * Exposes 75+ tools for prediction markets, social features, trading, and more.
 *
 * @route GET /api/mcp - Service discovery and capabilities
 * @route POST /api/mcp - JSON-RPC 2.0 tool execution
 */

import { withErrorHandling } from '@feed/api';
import {
  getMCPServerInfo,
  getServerCapabilities,
  type JsonRpcRequest,
  MCP_PROTOCOL_VERSIONS,
  type MCPAuthContext,
  MCPRequestHandler,
} from '@feed/mcp';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkApiKey } from '@/lib/api/check-api-key';

export const dynamic = 'force-dynamic';

/** Structural JSON-RPC 2.0 request/notification envelope (no batches). */
const JsonRpcEnvelopeSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1).max(200),
  params: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .optional(),
  id: z.union([z.string().max(200), z.number().finite()]).optional(),
});

function jsonRpcError(
  code: number,
  message: string,
  id: string | number | null,
  status: number
): NextResponse {
  return NextResponse.json(
    { jsonrpc: '2.0', error: { code, message }, id },
    { status }
  );
}

/**
 * GET /api/mcp
 * Returns MCP service information and capabilities
 */
export const GET = withErrorHandling(async function GET(request: NextRequest) {
  const { error } = await checkApiKey(request, 'Feed MCP');
  if (error) return error;

  const serverInfo = getMCPServerInfo();
  const capabilities = getServerCapabilities();

  return NextResponse.json(
    {
      service: serverInfo.name,
      version: serverInfo.version,
      protocol: 'MCP',
      protocolVersions: MCP_PROTOCOL_VERSIONS,
      capabilities,
      endpoint: '/api/mcp',
      documentation: 'https://docs.feed.fun/mcp',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=3600',
      },
    }
  );
});

/**
 * POST /api/mcp
 * Handles JSON-RPC 2.0 MCP protocol requests
 */
export const POST = withErrorHandling(async function POST(
  request: NextRequest
) {
  const { error, authResult } = await checkApiKey(request, 'Feed MCP');
  if (error) return error;

  // Parse JSON-RPC request
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonRpcError(-32700, 'Parse error: Invalid JSON', null, 400);
  }

  // Validate the JSON-RPC envelope before touching any property
  // (null, primitives and batch arrays are rejected as Invalid Request).
  const envelope = JsonRpcEnvelopeSchema.safeParse(rawBody);
  if (!envelope.success) {
    return jsonRpcError(-32600, 'Invalid Request', null, 400);
  }
  const body = envelope.data;

  // Notifications (no id) never get a JSON-RPC response; per the MCP
  // Streamable HTTP transport the server acknowledges with 202 Accepted.
  if (body.id === undefined) {
    return new NextResponse(null, { status: 202 });
  }

  const toolName =
    body.method === 'tools/call' &&
    body.params &&
    !Array.isArray(body.params) &&
    typeof body.params.name === 'string'
      ? body.params.name
      : undefined;

  logger.info('MCP request', {
    method: body.method,
    toolName,
    authMethod: authResult?.authMethod,
    userId: authResult?.userId,
    requestId: body.id,
  });

  // Create authentication context for tool execution
  const apiKey = request.headers.get('X-Feed-Api-Key');
  const authContext: MCPAuthContext = {
    apiKey: apiKey ?? undefined,
    userId: authResult?.userId,
  };

  // Delegate to MCP request handler
  const handler = new MCPRequestHandler();
  const response = await handler.handle(
    {
      jsonrpc: '2.0',
      method: body.method,
      params: body.params as JsonRpcRequest['params'],
      id: body.id,
    },
    authContext
  );

  // Log tool execution for audit trail
  if (
    authResult?.authMethod === 'user-key' &&
    body.method === 'tools/call' &&
    !response.error
  ) {
    const result = response.result as { isError?: boolean } | undefined;
    logger.info('MCP tool executed', {
      userId: authResult.userId,
      toolName,
      success: !result?.isError,
    });
  }

  return NextResponse.json(response, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
});
