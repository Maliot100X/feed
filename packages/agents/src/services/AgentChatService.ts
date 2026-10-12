/**
 * Agent Chat Service
 *
 * Provides coordinator-dispatch execution of agent chat.
 * Used by the DISPATCH_TO_AGENT action so the coordinator can
 * invoke a child agent on the user's behalf without going through
 * the HTTP layer.
 *
 * Design notes:
 * - broadcastChatMessage is injected as broadcastFn to avoid importing
 *   @feed/api from packages/agents (architectural separation)
 * - Only handles team-chat mode (coordinator dispatch always targets a team chat)
 * - Always uses ModelType.TEXT_SMALL (free tier = 0 pts cost)
 * - Max 2 iterations per dispatch.
 *
 * Efficiency optimizations (refactor/coordinator-efficiency):
 * - Providers are refreshed before each decision and summary.
 * - Parse retries use format reinforcement hints + lower temperature (0.3)
 * - All dispatches instrumented with action-type and timing telemetry
 */

import {
  composePromptFromState,
  type Memory,
  ModelType,
  parseKeyValueXml,
} from '@elizaos/core';
import { db, eq, messages, userAgentConfigs } from '@feed/db';
import type { MessageMetadata, MessageTag } from '@feed/shared';
import { checkUserInput, logger } from '@feed/shared';
import { v4 as uuidv4 } from 'uuid';
import { getEventBus } from '../communication/EventBus';
import { AuthorizationError } from '../errors';
import { generateSnowflakeId } from '../shared/snowflake';
import { agentService } from './AgentService';
import {
  formatAgentActionResults,
  requireAgentAction,
} from './agent-action-context';
import { notifyTeamChatMessage } from './team-chat-notifications';

// =============================================================================
// Types
// =============================================================================

/** Minimal broadcast function signature matching broadcastChatMessage from @feed/api */
export type BroadcastFn = (
  chatId: string,
  message: {
    id: string;
    content: string;
    chatId: string;
    senderId: string;
    type?: string;
    createdAt: string;
    metadata?: MessageMetadata | null;
  }
) => Promise<void>;

export interface CoordinatorDispatchParams {
  agentId: string;
  ownerId: string;
  /** The command/instruction to send to the agent */
  message: string;
  teamChatId: string;
  ownerName?: string;
  ownerUsername?: string;
  /** Injected from route layer — avoids importing @feed/api in packages/agents */
  broadcastFn: BroadcastFn;
}

export interface CoordinatorDispatchResult {
  success: boolean;
  response: string;
  agentId: string;
  agentUsername?: string;
  actionsExecuted: number;
  isLLMFailure: boolean;
  /** Set on ownership / not-found failures */
  error?: string;
}

// =============================================================================
// Decision + Summary Templates
// =============================================================================

const dispatchDecisionTemplate = `{{agentContext}}

---

# Your Character
{{system}}

{{#if personality}}
## Personality
{{personality}}
{{/if}}

{{#if tradingStrategy}}
## Trading Strategy
{{tradingStrategy}}
{{/if}}

---

# Your Identity in This Chat
You are **{{agentName}}** (@{{agentUsername}}) — an AI agent in the Agents team chat.
The chat is owned by **{{ownerName}}**. The coordinator has routed this instruction to you on their behalf.
**Your response will be posted as your message in the team chat, visible to the owner.**
Write in your own voice as if speaking directly to the team.

---

# Conversation History
{{recentMessages}}

---

# Instruction from {{ownerName}} (via Coordinator)
{{currentMessage}}

---

# Execution Context
Step {{iterationCount}} of {{maxIterations}} | Actions this round: {{actionCount}}

---

{{actionsWithParams}}

---

# Actions Completed This Round
{{#if actionCount}}
{{actionResults}}
**Use this data. Do NOT repeat these actions.**
{{else}}
No actions taken yet.
{{/if}}

---

# Decision Guide
- **Need to execute something?** → Use the appropriate action from the list above
- **Request complete?** → Set isFinish: true and leave action as ""
- **NEVER repeat the same action with same parameters**
- **Trades execute ONCE** — don't repeat buy/sell
- **You are an agent, not the coordinator** — do NOT dispatch to other agents

<keys>
"thought" Your reasoning: what was asked? what have you done? what's next?
"action" Action name or "" if done
"parameters" JSON params or {}
"isFinish" true when request is satisfied
</keys>

YOUR FINAL OUTPUT MUST BE IN THIS XML FORMAT:
<output>
<response>
  <thought>Step {{iterationCount}}/{{maxIterations}}. Actions this round: {{actionCount}}. [Your reasoning]</thought>
  <action>ACTION_NAME or ""</action>
  <parameters>
    {
      "param1": "value1"
    }
  </parameters>
  <isFinish>true | false</isFinish>
</response>
</output>`;

const dispatchSummaryTemplate = `# Your Character
{{system}}

{{#if personality}}
## Personality
{{personality}}
{{/if}}

{{#if tradingStrategy}}
## Trading Strategy
{{tradingStrategy}}
{{/if}}

---

# Your Identity in This Chat
You are **{{agentName}}** (@{{agentUsername}}) in the Agents team chat owned by **{{ownerName}}**.
You were dispatched by the coordinator to handle: "{{currentMessage}}"

**IMPORTANT: The text you write below IS your team chat message.**
It will be posted under your name (@{{agentUsername}}) and seen by {{ownerName}}.
Write in first person, in character, as if speaking directly to the team.
Do NOT address "the coordinator" or refer to yourself in third person.

---

# Recent Conversation
{{recentMessages}}

---

# Actions You Completed
{{actionResults}}

---

# Your Task
Craft your team chat message **in character** — your tone, voice, and wording must match your Character and Personality.

- Speak directly as yourself, to {{ownerName}} and the team
- Report what you did and the concrete results (numbers, names, statuses)
- Be vivid and on-brand — this is your message, not a status report to the coordinator
- Be concise

Output ONLY this XML:

<response>
<thought>Brief reasoning: what I did, key data to include, how to phrase it in my voice</thought>
<text>Your team chat message in character — direct, specific, and in your own voice</text>
</response>`;

/** Format hint appended to the prompt on parse retries. */
const DECISION_XML_FORMAT_HINT =
  '\n\nYour previous response could not be parsed. Output ONLY this exact XML structure with no text outside the tags:\n<response>\n  <thought>reasoning</thought>\n  <action>ACTION_NAME or ""</action>\n  <parameters>{}</parameters>\n  <isFinish>true or false</isFinish>\n</response>';

const SUMMARY_XML_FORMAT_HINT =
  '\n\nYour previous response could not be parsed. Output ONLY this exact XML structure with no text outside the tags:\n<response>\n  <thought>reasoning</thought>\n  <text>Your response</text>\n</response>';

type ActionTraceResult = {
  actionType: string;
  success: boolean;
  text: string;
  error?: string;
  values?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  timestamp: number;
  durationMs?: number;
  tag?: MessageTag;
};

// =============================================================================
// Core Dispatch Function
// =============================================================================

/**
 * Execute an agent chat session on behalf of the coordinator.
 *
 * Called by the DISPATCH_TO_AGENT action handler in plugin-user-core.
 * Runs the full multi-step LLM loop for the target agent and writes
 * the response to the shared team chat (same teamChatId as the coordinator).
 */
export async function dispatchAgentChat(
  params: CoordinatorDispatchParams
): Promise<CoordinatorDispatchResult> {
  const dispatchStartMs = Date.now();

  const {
    agentId,
    ownerId,
    message,
    teamChatId,
    ownerName = 'User',
    ownerUsername,
    broadcastFn,
  } = params;

  // --- Input validation (defense-in-depth: command is LLM-generated from user input) ---
  const inputCheck = checkUserInput(message);
  if (!inputCheck.safe) {
    logger.warn(
      '[AgentChatService] Unsafe command blocked before dispatch',
      { agentId, reason: inputCheck.reason },
      'AgentChatService'
    );
    return {
      success: false,
      response: '',
      agentId,
      actionsExecuted: 0,
      isLLMFailure: false,
      error: inputCheck.reason ?? 'Invalid command content',
    };
  }

  // --- Ownership verification (with fuzzy name fallback) ---
  let agentWithConfig;
  let resolvedAgentId = agentId;
  try {
    agentWithConfig = await agentService.getAgentWithConfig(agentId, ownerId);

    // Fallback: if not found by ID, try resolving by username or displayName.
    // The LLM often passes a username, display name, or partial name instead of
    // the UUID. We try progressively fuzzier matching to maximize resolution:
    //   1. Exact match on username or displayName (case-insensitive)
    //   2. Normalized match (strip spaces, punctuation)
    //   3. Partial match (needle contained in name or vice versa)
    //   4. Single-agent fallback (if only 1 agent, use it regardless of name)
    if (!agentWithConfig) {
      const ownerAgents = await agentService.listUserAgents(ownerId);
      const needle = agentId.toLowerCase().trim();
      const normalizeAgentName = (value: string | null | undefined): string =>
        value?.toLowerCase().replace(/[\s\-_.]+/g, '') ?? '';
      const needleNormalized = normalizeAgentName(needle);
      const isGenericSingleAgentReference = new Set([
        'agent',
        'agents',
        'myagent',
        'myagents',
        'theagent',
      ]).has(needleNormalized);

      // 1. Exact match on username or displayName
      const exactMatches = ownerAgents.filter(
        (a) =>
          a.username?.toLowerCase() === needle ||
          a.displayName?.toLowerCase() === needle
      );

      if (exactMatches.length > 1)
        throw new Error('Ambiguous agent name; use its ID');
      let match = exactMatches[0];

      // 2. Normalized match (strip spaces/punctuation for "larry david" vs "larrydavid")
      if (!match) {
        const normalizedMatches = ownerAgents.filter((a) => {
          const uNorm = normalizeAgentName(a.username);
          const dNorm = normalizeAgentName(a.displayName);
          return (
            Boolean(needleNormalized) &&
            (uNorm === needleNormalized || dNorm === needleNormalized)
          );
        });
        if (normalizedMatches.length > 1)
          throw new Error('Ambiguous normalized agent name; use its ID');
        match = normalizedMatches[0];
      }

      // 3. Partial match (needle contained in name or name contained in needle).
      // Only accept unambiguous matches to avoid dispatching to the wrong agent.
      if (!match) {
        const partialMatches = ownerAgents.filter((a) => {
          const uLower = a.username?.toLowerCase() ?? '';
          const dLower = a.displayName?.toLowerCase() ?? '';
          return (
            (uLower && (uLower.includes(needle) || needle.includes(uLower))) ||
            (dLower && (dLower.includes(needle) || needle.includes(dLower)))
          );
        });
        if (partialMatches.length === 1) {
          match = partialMatches[0];
        } else if (partialMatches.length > 1) {
          logger.warn(
            '[AgentChatService] Agent resolution failed — ambiguous partial match',
            {
              input: agentId,
              partialMatches: partialMatches.map(
                (a) => a.displayName ?? a.username ?? a.id
              ),
            },
            'AgentChatService'
          );
        }
      }

      // 4. Single-agent fallback only for generic references like "my agent".
      if (!match && ownerAgents.length === 1 && isGenericSingleAgentReference) {
        match = ownerAgents[0];
        logger.info(
          '[AgentChatService] Single-agent fallback used',
          {
            input: agentId,
            resolvedId: match!.id,
            resolvedName: match!.displayName ?? match!.username,
          },
          'AgentChatService'
        );
      }

      if (match) {
        resolvedAgentId = match.id;
        agentWithConfig = await agentService.getAgentWithConfig(
          resolvedAgentId,
          ownerId
        );
        logger.info(
          '[AgentChatService] Resolved agent by name fallback',
          {
            input: agentId,
            resolvedId: resolvedAgentId,
            resolvedName: match.displayName ?? match.username,
          },
          'AgentChatService'
        );
      } else {
        // Log available agents for debugging failed resolution
        const available = ownerAgents.map(
          (a) => `${a.displayName ?? a.username ?? 'unnamed'} (${a.id})`
        );
        logger.warn(
          '[AgentChatService] Agent resolution failed — no match found',
          { input: agentId, availableAgents: available },
          'AgentChatService'
        );
      }
    }
  } catch (err) {
    const errorMsg =
      err instanceof AuthorizationError
        ? 'You do not have permission to access this agent.'
        : err instanceof Error
          ? err.message
          : 'Unknown authorization error';
    logger.warn(
      '[AgentChatService] Ownership check failed',
      { agentId: resolvedAgentId, ownerId, error: errorMsg },
      'AgentChatService'
    );
    return {
      success: false,
      response: '',
      agentId: resolvedAgentId,
      actionsExecuted: 0,
      isLLMFailure: false,
      error: errorMsg,
    };
  }

  if (!agentWithConfig) {
    // List available agents in the error so the coordinator can retry with correct ID
    let availableHint = '';
    try {
      const ownerAgents = await agentService.listUserAgents(ownerId);
      if (ownerAgents.length > 0) {
        const names = ownerAgents
          .map((a) => `@${a.username ?? a.displayName ?? a.id}`)
          .join(', ');
        availableHint = `. Available agents: ${names}`;
      }
    } catch {
      // Best-effort — don't let hint lookup mask the real error
    }
    return {
      success: false,
      response: '',
      agentId: resolvedAgentId,
      actionsExecuted: 0,
      isLLMFailure: false,
      error: `Agent "${agentId}" not found${availableHint}`,
    };
  }

  const agentConfig = agentWithConfig.agentConfig;
  const agentUsername = agentWithConfig.username ?? undefined;
  const agentName =
    agentWithConfig.displayName ?? agentWithConfig.username ?? 'Agent';

  // Always free tier for coordinator-dispatched calls
  const modelType = ModelType.TEXT_SMALL;

  // --- Get agent runtime ---
  // Dynamic import breaks the circular dep: AgentRuntimeManager → plugin-user-core → dispatch-to-agent → AgentChatService
  const { agentRuntimeManager } = await import(
    '../runtime/AgentRuntimeManager'
  );
  const runtime = await agentRuntimeManager.getRuntime(resolvedAgentId);

  const elizaMessage: Memory = {
    id: uuidv4() as `${string}-${string}-${string}-${string}-${string}`,
    entityId: ownerId as `${string}-${string}-${string}-${string}-${string}`,
    roomId:
      resolvedAgentId as `${string}-${string}-${string}-${string}-${string}`,
    content: { text: message, teamChatId, ownerId, agentId: resolvedAgentId },
    createdAt: Date.now(),
  };

  // --- Multi-step execution loop (max 2 iterations) ---
  // Reduced from 4: dispatched agents almost always finish in 1 iteration
  // (single action + finish). 2nd iteration covers edge cases like retries.
  // coordinator ≈ 3s + dispatch ≈ 4s (2 iters × 2s) + summary ≈ 2s = ~9s
  const MAX_ITERATIONS = 2;
  const traceActionResults: ActionTraceResult[] = [];
  let finalResponse: string | null = null;
  const isLLMFailure = false;
  let totalParseRetries = 0;
  let iterationsRan = 0;

  // Refresh context after actions; use only the configured chat providers.

  const agentProviders = [
    'AGENT_CONTEXT',
    'RECENT_MESSAGES',
    'ACTION_STATE',
    'ACTIONS',
    'TEAM_MEMBERS',
  ];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    iterationsRan = iteration;

    logger.info(
      `[AgentChatService] Iteration ${iteration}/${MAX_ITERATIONS}`,
      { agentId: resolvedAgentId, actionsCompleted: traceActionResults.length },
      'AgentChatService'
    );

    // Providers can depend on state changed by the preceding action.
    const state = await runtime.composeState(
      elizaMessage,
      agentProviders,
      true,
      true
    );

    if (
      typeof state.values.recentMessages !== 'string' ||
      !state.values.recentMessages.trim()
    ) {
      throw new Error('Required conversation history context is missing');
    }
    if (typeof state.values.actionsWithParams !== 'string') {
      throw new Error('Required action schema context is missing');
    }

    state.values = {
      ...state.values,
      agentId: resolvedAgentId,
      system: agentConfig?.systemPrompt ?? 'You are a helpful AI assistant.',
      personality: agentConfig?.personality ?? '',
      tradingStrategy: agentConfig?.tradingStrategy ?? '',
      currentMessage: message,
      iterationCount: iteration,
      maxIterations: MAX_ITERATIONS,
      actionCount: traceActionResults.length,
      ownerId,
      ownerName,
      ownerUsername,
      isTeamChatMode: true,
      teamChatId,
      teamChatOwnerName: ownerName,
      teamChatOwnerUsername: ownerUsername,
      agentName,
      agentUsername: agentUsername ?? '',
    };

    state.data = {
      ...state.data,
      // Cast: Feed ActionTraceResult is a superset of elizaos ActionResult
      actionResults:
        traceActionResults as unknown as typeof state.data.actionResults,
    };
    state.values = {
      ...state.values,
      actionResults: formatAgentActionResults(traceActionResults),
      hasActionResults: traceActionResults.length > 0,
    };

    const prompt = composePromptFromState({
      state,
      template: dispatchDecisionTemplate,
    });

    const MAX_PARSE_RETRIES = 3;
    let parsedStep: Record<string, unknown> | null = null;

    for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
      const response = await runtime.useModel(modelType, {
        prompt: attempt > 1 ? prompt + DECISION_XML_FORMAT_HINT : prompt,
        temperature: attempt > 1 ? 0.3 : 0.7,
        maxTokens: 1200,
      });

      parsedStep = parseKeyValueXml(response);

      if (parsedStep) break;

      totalParseRetries++;
      logger.warn(
        `[AgentChatService] Failed to parse decision (attempt ${attempt})`,
        { preview: response.substring(0, 200) },
        'AgentChatService'
      );
    }

    if (!parsedStep) {
      return {
        success: false,
        response: '',
        agentId: resolvedAgentId,
        actionsExecuted: traceActionResults.length,
        isLLMFailure: true,
        error: 'Agent decision could not be parsed after three attempts',
      };
    }

    if (
      typeof parsedStep.action !== 'string' ||
      !['true', 'false', true, false].includes(
        parsedStep.isFinish as string | boolean
      )
    ) {
      throw new Error('Agent decision requires action and boolean isFinish');
    }
    const action = parsedStep.action.trim();
    const isFinish = parsedStep.isFinish;
    if (!action) {
      if (isFinish !== 'true' && isFinish !== true) {
        throw new Error('Empty action requires an explicit finish decision');
      }
      break;
    }

    await requireAgentAction(runtime, action, elizaMessage, state);
    const actionStartMs = Date.now();
    const parameters: unknown =
      typeof parsedStep.parameters === 'string'
        ? JSON.parse(parsedStep.parameters)
        : parsedStep.parameters;
    if (
      typeof parameters !== 'object' ||
      parameters === null ||
      Array.isArray(parameters)
    ) {
      throw new Error('Agent action parameters must be a JSON object');
    }
    const actionParams = parameters as Record<string, unknown>;

    state.data = {
      ...state.data,
      actionParams,
    };

    // Persist actionParams to stateCache so processActions' internal
    // composeState() preserves them (it re-composes from cache, discarding
    // any local state.data modifications).
    const stateCache = (
      runtime as unknown as {
        stateCache?: Map<
          string,
          {
            values?: Record<string, unknown>;
            data?: Record<string, unknown>;
            text?: string;
          }
        >;
      }
    ).stateCache;
    if (stateCache && elizaMessage.id) {
      const cached = stateCache.get(elizaMessage.id);
      if (cached) {
        cached.data = { ...cached.data, actionParams };
      }
    }

    const actionContent = {
      text: `Executing action: ${action}`,
      actions: [action],
    };

    const actionMessage: Memory = {
      id: uuidv4() as `${string}-${string}-${string}-${string}-${string}`,
      entityId: runtime.agentId,
      roomId: elizaMessage.roomId,
      createdAt: Date.now(),
      content: actionContent,
    };

    try {
      let actionResult: {
        success?: boolean;
        text?: string;
        values?: Record<string, unknown>;
        tag?: MessageTag;
      } | null = null;

      await runtime.processActions(
        elizaMessage,
        [actionMessage],
        state,
        async (results: unknown) => {
          const resultsArray = results as Array<{
            content?: {
              success?: boolean;
              text?: string;
              values?: Record<string, unknown>;
              tag?: MessageTag;
            };
          }> | null;
          if (resultsArray && resultsArray.length > 0) {
            const firstResult = resultsArray[0];
            if (firstResult) {
              actionResult = {
                success: firstResult.content?.success ?? false,
                text:
                  typeof firstResult.content?.text === 'string'
                    ? firstResult.content.text
                    : undefined,
                values: firstResult.content?.values,
                tag: firstResult.content?.tag,
              };
            }
          }
          return [];
        }
      );

      // Fallback: check stateCache if callback didn't fire
      if (!actionResult) {
        const cachedState = (
          runtime as unknown as { stateCache?: Map<string, unknown> }
        ).stateCache?.get(`${elizaMessage.id}_action_results`) as
          | {
              values?: {
                actionResults?: Array<{
                  success?: boolean;
                  text?: string;
                  values?: Record<string, unknown>;
                }>;
              };
            }
          | undefined;
        const cached = cachedState?.values?.actionResults || [];
        actionResult =
          cached.length > 0 ? (cached[cached.length - 1] ?? null) : null;
      }

      if (!actionResult || typeof actionResult.success !== 'boolean') {
        throw new Error(`Action ${action} did not return a completion result`);
      }
      const success = actionResult.success;

      traceActionResults.push({
        actionType: action,
        success,
        text:
          actionResult?.text ||
          (success
            ? `${action} executed`
            : `${action} returned no successful result`),
        error: success ? undefined : actionResult?.text,
        values: actionResult?.values,
        parameters: actionParams,
        timestamp: Date.now(),
        durationMs: Date.now() - actionStartMs,
        tag: actionResult?.tag,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      traceActionResults.push({
        actionType: action,
        success: false,
        text: `Action failed: ${errorMsg}`,
        error: errorMsg,
        parameters: actionParams,
        timestamp: Date.now(),
        durationMs: Date.now() - actionStartMs,
      });
    }

    const failedAction = traceActionResults.at(-1);
    if (failedAction && !failedAction.success) {
      return {
        success: false,
        response: '',
        agentId: resolvedAgentId,
        actionsExecuted: traceActionResults.length,
        isLLMFailure: false,
        error: failedAction.error || failedAction.text || `${action} failed`,
      };
    }

    if (isFinish === 'true' || isFinish === true) {
      break;
    }
  }

  // Log decision loop completion with telemetry (Phase 0 instrumentation)
  logger.info(
    '[AgentChatService] Decision loop completed',
    {
      agentId: resolvedAgentId,
      iterations: iterationsRan,
      actionsExecuted: traceActionResults.length,
      actionTypes: traceActionResults.map((r) => r.actionType),
      isLLMFailure,
      totalParseRetries,
      decisionLoopMs: Date.now() - dispatchStartMs,
    },
    'AgentChatService'
  );

  // --- Generate summary response ---
  // Refresh providers after the final action so the summary sees its effects.
  if (!finalResponse) {
    const summaryState = await runtime.composeState(
      elizaMessage,
      agentProviders,
      true,
      true
    );

    if (
      typeof summaryState.values.recentMessages !== 'string' ||
      !summaryState.values.recentMessages.trim()
    ) {
      throw new Error(
        'Required summary conversation history context is missing'
      );
    }

    summaryState.values = {
      ...summaryState.values,
      agentId: resolvedAgentId,
      system: agentConfig?.systemPrompt ?? 'You are a helpful AI assistant.',
      personality: agentConfig?.personality ?? '',
      tradingStrategy: agentConfig?.tradingStrategy ?? '',
      currentMessage: message,
      ownerId,
      ownerName,
      ownerUsername,
      isTeamChatMode: true,
      teamChatId,
      teamChatOwnerName: ownerName,
      teamChatOwnerUsername: ownerUsername,
      agentName,
      agentUsername: agentUsername ?? '',
      actionCount: traceActionResults.length,
      actionResults: formatAgentActionResults(traceActionResults),
      hasActionResults: traceActionResults.length > 0,
    };
    summaryState.data = {
      ...summaryState.data,
      // Cast: Feed ActionTraceResult is a superset of elizaos ActionResult
      actionResults:
        traceActionResults as unknown as typeof summaryState.data.actionResults,
    };

    const summaryPrompt = composePromptFromState({
      state: summaryState,
      template: dispatchSummaryTemplate,
    });

    const SUMMARY_RETRIES = 3;
    let extractedText: string | undefined;

    for (let attempt = 1; attempt <= SUMMARY_RETRIES; attempt++) {
      const summaryResponse = await runtime.useModel(modelType, {
        prompt:
          attempt > 1 ? summaryPrompt + SUMMARY_XML_FORMAT_HINT : summaryPrompt,
        temperature: attempt > 1 ? 0.3 : 0.7,
        maxTokens: 1200,
      });

      const summary = parseKeyValueXml(summaryResponse);
      extractedText = summary?.text as string | undefined;

      if (extractedText) break;

      totalParseRetries++;
      logger.warn(
        `[AgentChatService] Failed to parse summary (attempt ${attempt})`,
        { preview: summaryResponse.substring(0, 200) },
        'AgentChatService'
      );
    }

    if (!extractedText?.trim()) {
      return {
        success: false,
        response: '',
        agentId: resolvedAgentId,
        actionsExecuted: traceActionResults.length,
        isLLMFailure: true,
        error: 'Agent summary could not be generated after three attempts',
      };
    }
    finalResponse = extractedText;
  }

  if (!finalResponse?.trim()) throw new Error('Agent response is missing');
  const responseText = finalResponse;

  // --- Collect rich tags for metadata ---
  const tags: MessageTag[] = traceActionResults
    .filter((r) => r.success && r.tag)
    .map((r) => r.tag as MessageTag);
  const messageMetadata: MessageMetadata | null =
    tags.length > 0 ? { tags } : null;

  // --- Write agent response to team chat messages table ---
  const responseMessageId = await generateSnowflakeId();
  const responseTime = new Date();

  await db.insert(messages).values({
    id: responseMessageId,
    chatId: teamChatId,
    senderId: resolvedAgentId,
    content: responseText,
    createdAt: responseTime,
    metadata: messageMetadata,
  });

  await notifyTeamChatMessage({
    chatId: teamChatId,
    messageId: responseMessageId,
    senderId: resolvedAgentId,
    messagePreview: responseText,
  });

  // Update agent's lastChatAt
  await db
    .update(userAgentConfigs)
    .set({ lastChatAt: new Date(), updatedAt: new Date() })
    .where(eq(userAgentConfigs.userId, resolvedAgentId));

  // --- Broadcast so SSE clients see the agent response immediately ---
  await broadcastFn(teamChatId, {
    id: responseMessageId,
    content: responseText,
    chatId: teamChatId,
    senderId: resolvedAgentId,
    type: 'user',
    createdAt: responseTime.toISOString(),
    metadata: messageMetadata,
  });

  // Full dispatch telemetry (Phase 0 instrumentation)
  const totalDurationMs = Date.now() - dispatchStartMs;
  logger.info(
    '[AgentChatService] Dispatch completed',
    {
      agentId: resolvedAgentId,
      iterations: iterationsRan,
      actionsExecuted: traceActionResults.length,
      actionTypes: traceActionResults.map((r) => r.actionType),
      isLLMFailure,
      totalParseRetries,
      totalDurationMs,
    },
    'AgentChatService'
  );

  // Publish dispatch result to EventBus for inter-agent awareness.
  // Other agents or services can subscribe to 'agent.dispatch.result' events
  // to build contextual awareness of what's happening across the team.
  const eventBus = getEventBus();
  eventBus.publish(
    'agent.dispatch.result',
    {
      agentId: resolvedAgentId,
      agentUsername: agentUsername ?? null,
      command: params.message,
      response: responseText.slice(0, 500),
      actionsExecuted: traceActionResults.length,
      success: true,
      timestamp: new Date().toISOString(),
    },
    resolvedAgentId
  );

  return {
    success: true,
    response: responseText,
    agentId: resolvedAgentId,
    agentUsername,
    actionsExecuted: traceActionResults.length,
    isLLMFailure,
  };
}
