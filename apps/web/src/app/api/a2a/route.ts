/**
 * A2A Protocol Endpoint
 *
 * Implements the standard A2A protocol using @a2a-js/sdk.
 * Handles Agent-to-Agent JSON-RPC 2.0 requests over HTTP.
 *
 * @openapi
 * /api/a2a:
 *   post:
 *     tags:
 *       - A2A Protocol
 *     summary: A2A JSON-RPC endpoint
 *     description: Handles all Agent-to-Agent JSON-RPC 2.0 requests over HTTP for autonomous agent communication.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jsonrpc
 *               - method
 *             properties:
 *               jsonrpc:
 *                 type: string
 *                 enum: ["2.0"]
 *               method:
 *                 type: string
 *                 description: A2A method name (e.g., message/send, tasks/get)
 *               params:
 *                 type: object
 *               id:
 *                 type: string
 *     responses:
 *       200:
 *         description: JSON-RPC response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jsonrpc:
 *                   type: string
 *                 result:
 *                   type: object
 *                 error:
 *                   type: object
 *                 id:
 *                   type: string
 *   get:
 *     tags:
 *       - A2A Protocol
 *     summary: A2A service info
 *     description: Returns A2A protocol service information and agent card endpoint.
 *     responses:
 *       200:
 *         description: Service info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 service:
 *                   type: string
 *                 version:
 *                   type: string
 *                 status:
 *                   type: string
 *                 endpoint:
 *                   type: string
 *                 agentCard:
 *                   type: string
 */

import {
  DefaultExecutionEventBusManager,
  DefaultRequestHandler,
  JsonRpcTransportHandler,
} from '@a2a-js/sdk/server';
import {
  authorizeTaskReference,
  FeedAgentExecutor,
  feedAgentCard,
  PersistentTaskStore,
  scopeRequestToCaller,
} from '@feed/a2a';
import { withErrorHandling } from '@feed/api';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseJsonRpcEnvelope } from '@/lib/a2a/jsonrpc-guard';
import { checkApiKey } from '@/lib/api/check-api-key';

// Initialize A2A protocol components with Redis-backed persistence
const taskStore = new PersistentTaskStore();
const executor = new FeedAgentExecutor();
const eventBusManager = new DefaultExecutionEventBusManager();
const requestHandler = new DefaultRequestHandler(
  feedAgentCard,
  taskStore,
  executor,
  eventBusManager
);
const jsonRpcHandler = new JsonRpcTransportHandler(requestHandler);

export const dynamic = 'force-dynamic';

/**
 * POST /api/a2a
 *
 * Handles JSON-RPC 2.0 A2A protocol requests. Processes agent-to-agent communication
 * tasks including message sending, task execution, and agent discovery.
 *
 * Supports authentication via:
 * - Server API key (FEED_A2A_API_KEY)
 * - Per-user API keys (from userApiKeys table)
 *
 * @param request - Next.js request containing JSON-RPC 2.0 A2A protocol message
 * @returns JSON-RPC 2.0 response with result or error
 * @throws {401} Invalid or missing API key
 */
export const POST = withErrorHandling(async function POST(
  request: NextRequest
) {
  const { error, authResult } = await checkApiKey(request);
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error: Invalid JSON' },
        id: null,
      },
      { status: 400 }
    );
  }

  // Validate the envelope before reading from it: null, primitive or array
  // bodies (and non-object params) get a JSON-RPC error instead of a 500.
  const envelopeCheck = parseJsonRpcEnvelope(body);
  if (envelopeCheck.errorResponse) return envelopeCheck.errorResponse;

  logger.info('Official A2A request', {
    method: body.method,
    taskId: body.params?.message?.taskId,
    authMethod: authResult?.authMethod,
    userId: authResult?.userId,
  });

  // SECURITY: User-scoped execution for user API keys.
  // For per-user API keys the ACTOR identity (contextId) is bound to the
  // authenticated user, preventing impersonation. params.userId is NOT
  // enforced because many operations use it as the TARGET.
  if (authResult) {
    const scope = scopeRequestToCaller(body, authResult);
    if (!scope.ok) {
      logger.error('User API key authenticated but userId is missing', {
        authMethod: authResult.authMethod,
      });
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: { code: -32001, message: scope.message },
          id: body.id ?? null,
        },
        { status: 401 }
      );
    }

    // Tasks are addressed by ID; only their owner may read or act on them.
    const taskAccess = await authorizeTaskReference(
      body,
      authResult,
      taskStore
    );
    if (!taskAccess.ok) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Task not found' },
          id: body.id ?? null,
        },
        { status: 404 }
      );
    }
  }

  // SECURITY: Server API key and localhost bypass
  // These auth methods allow arbitrary contextId, which enables acting as any user.
  // This is intentional for admin/internal operations but should be monitored.
  if (
    authResult?.authMethod === 'server-key' ||
    authResult?.authMethod === 'localhost'
  ) {
    const providedContextId =
      body.params?.message?.contextId ?? body.params?.contextId;
    if (providedContextId !== undefined && providedContextId !== null) {
      // Log server-key operations with user context for audit trail
      logger.info('Server/localhost A2A operation with user context', {
        authMethod: authResult.authMethod,
        contextId: providedContextId,
        method: body.method,
        operation: body.params?.message?.parts?.[0]?.data?.operation,
      });
    }
  }

  // Delegate all A2A methods to the SDK's JSON-RPC transport handler
  // This includes message/send, message/stream, tasks/get, tasks/list, etc.
  // The SDK handles task persistence, streaming, and event bus management internally
  const response = await jsonRpcHandler.handle(body);

  return NextResponse.json(response, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
});

/**
 * GET /api/a2a
 *
 * Returns the Feed agent card (capabilities, endpoints, metadata) for A2A protocol discovery.
 * Provides agent information for external agents to discover and interact with this agent.
 *
 * Supports authentication via:
 * - Server API key (FEED_A2A_API_KEY)
 * - Per-user API keys (from userApiKeys table)
 *
 * @param request - Next.js request (API key required in X-Feed-Api-Key header)
 * @returns Agent card JSON with capabilities and metadata
 * @throws {401} Invalid or missing API key
 */
export const GET = withErrorHandling(async function GET(request: NextRequest) {
  const { error } = await checkApiKey(request);
  if (error) return error;

  return NextResponse.json(feedAgentCard, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});
