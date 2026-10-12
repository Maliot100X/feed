/**
 * Action-Level Instrumentation
 *
 * Wraps actions with trajectory logging
 */

import type {
  Action,
  IAgentRuntime,
  Memory,
  Plugin,
  State,
} from '@elizaos/core';
import type { JsonValue } from '@feed/shared';
import { logger } from '../../../shared/logger';

interface RuntimeEnvironmentState {
  timestamp?: number;
  agentBalance: number;
  agentPoints?: number;
  agentPnL: number;
  openPositions: number;
  activeMarkets?: number;
  portfolioValue?: number;
  unreadMessages?: number;
  recentEngagement?: number;
  custom?: Record<string, JsonValue>;
  [key: string]: JsonValue | undefined;
}

interface RuntimeLLMCall {
  metadata?: Record<string, JsonValue>;
  model: string;
  modelVersion?: string;
  systemPrompt: string;
  userPrompt: string;
  response: string;
  reasoning?: string;
  temperature: number;
  maxTokens: number;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  topP?: number;
  messages?: Array<{ role: string; content: string }>;
  purpose: 'action' | 'reasoning' | 'evaluation' | 'response' | 'other';
  actionType?: string;
}

interface RuntimeProviderAccess {
  providerName: string;
  data: Record<string, JsonValue>;
  purpose: string;
  query?: Record<string, JsonValue>;
}

interface RuntimeActionAttempt {
  actionType: string;
  actionName?: string;
  parameters: Record<string, JsonValue>;
  success: boolean;
  result?: Record<string, JsonValue>;
  error?: string;
  reasoning?: string;
}

export interface RuntimeTrajectoryLogger {
  startStep(trajectoryId: string, envState: RuntimeEnvironmentState): string;
  getCurrentStepId(trajectoryId: string): string | null;
  logLLMCall(stepId: string, llmCall: RuntimeLLMCall): void;
  logProviderAccess(stepId: string, access: RuntimeProviderAccess): void;
  completeStep(
    trajectoryId: string,
    stepId: string,
    action: RuntimeActionAttempt,
    rewardInfo?: { reward?: number }
  ): void;
}

type EnvironmentStateProvider = () => Promise<RuntimeEnvironmentState>;

/**
 * Context for trajectory logging during action execution
 */
interface TrajectoryContext {
  trajectoryId: string;
  logger: RuntimeTrajectoryLogger;
  environmentStateProvider?: EnvironmentStateProvider;
}

// Global context storage (per runtime instance)
const trajectoryContexts = new WeakMap<IAgentRuntime, TrajectoryContext>();

/**
 * Set trajectory context for a runtime
 */
export function setTrajectoryContext(
  runtime: IAgentRuntime,
  trajectoryId: string,
  trajectoryLogger: RuntimeTrajectoryLogger,
  environmentStateProvider?: EnvironmentStateProvider
): void {
  trajectoryContexts.set(runtime, {
    trajectoryId,
    logger: trajectoryLogger,
    environmentStateProvider,
  });
}

/**
 * Get trajectory context for a runtime
 */
export function getTrajectoryContext(
  runtime: IAgentRuntime
): TrajectoryContext | null {
  return trajectoryContexts.get(runtime) || null;
}

/**
 * Clear trajectory context for a runtime
 * Should be called after ending a trajectory to prevent stale context
 */
export function clearTrajectoryContext(runtime: IAgentRuntime): void {
  trajectoryContexts.delete(runtime);
}

function buildDefaultEnvironmentState(): RuntimeEnvironmentState {
  return {
    timestamp: Date.now(),
    agentBalance: 0,
    agentPoints: 0,
    agentPnL: 0,
    openPositions: 0,
    activeMarkets: 0,
  };
}

async function getEnvironmentState(
  context: TrajectoryContext
): Promise<RuntimeEnvironmentState> {
  const provided = context.environmentStateProvider
    ? await context.environmentStateProvider()
    : undefined;

  return {
    ...buildDefaultEnvironmentState(),
    ...provided,
    timestamp: provided?.timestamp ?? Date.now(),
  };
}

export async function ensureTrajectoryStep(runtime: IAgentRuntime): Promise<{
  trajectoryId: string;
  logger: RuntimeTrajectoryLogger;
  stepId: string;
} | null> {
  const context = getTrajectoryContext(runtime);
  if (!context) {
    return null;
  }

  const existingStepId = context.logger.getCurrentStepId(context.trajectoryId);
  if (existingStepId) {
    return {
      trajectoryId: context.trajectoryId,
      logger: context.logger,
      stepId: existingStepId,
    };
  }

  const environmentState = await getEnvironmentState(context);
  const stepId = context.logger.startStep(
    context.trajectoryId,
    environmentState
  );

  return {
    trajectoryId: context.trajectoryId,
    logger: context.logger,
    stepId,
  };
}

/**
 * Wrap an action with logging
 */
export function wrapActionWithLogging(
  action: Action,
  _trajectoryLogger: RuntimeTrajectoryLogger
): Action {
  const originalHandler = action.handler;
  return {
    ...action,
    handler: async (runtime, message, state, options, callback, responses) => {
      const activeStep = await ensureTrajectoryStep(runtime);
      let result: Awaited<ReturnType<Action['handler']>>;
      try {
        if (typeof originalHandler !== 'function')
          throw new Error(`Action ${action.name} has no handler`);
        result = await originalHandler(
          runtime,
          message,
          state,
          options,
          callback,
          responses
        );
        if (!result || typeof result.success !== 'boolean')
          throw new Error(`Action ${action.name} returned no explicit outcome`);
      } catch (error) {
        if (activeStep) {
          const detail = error instanceof Error ? error.message : String(error);
          activeStep.logger.completeStep(
            activeStep.trajectoryId,
            activeStep.stepId,
            {
              actionType: action.name,
              actionName: action.name,
              parameters: { message: message.content.text ?? '' },
              success: false,
              error: detail,
              result: { error: detail },
            },
            { reward: -0.1 }
          );
        }
        throw error;
      }
      if (activeStep) {
        const error =
          result.error instanceof Error ? result.error.message : result.error;
        activeStep.logger.completeStep(
          activeStep.trajectoryId,
          activeStep.stepId,
          {
            actionType: action.name,
            actionName: action.name,
            parameters: {
              message: message.content.text ?? '',
              options: options ? JSON.parse(JSON.stringify(options)) : {},
            },
            success: result.success,
            result: JSON.parse(JSON.stringify({ ...result, error })),
            ...(error ? { error } : {}),
          },
          { reward: result.success ? 0.1 : -0.1 }
        );
      }
      return result;
    },
  };
}

/**
 * Wrap all plugin actions
 */
export function wrapPluginActions(
  plugin: Plugin,
  trajectoryLogger: RuntimeTrajectoryLogger
): Plugin {
  if (!plugin.actions || plugin.actions.length === 0) {
    return plugin;
  }

  return {
    ...plugin,
    actions: plugin.actions.map((action) =>
      wrapActionWithLogging(action, trajectoryLogger)
    ),
  };
}

/**
 * Log LLM call from action context
 */
export function logLLMCallFromAction(
  actionContext: Record<string, JsonValue | undefined>,
  trajectoryLogger: RuntimeTrajectoryLogger,
  trajectoryId: string
): void {
  const stepId = trajectoryLogger.getCurrentStepId(trajectoryId);
  if (!stepId) {
    logger.warn('No active step for LLM call from action', { trajectoryId });
    return;
  }

  const str = (key: string): string | undefined => {
    const value = actionContext[key];
    return typeof value === 'string' ? value : undefined;
  };
  // Nullish (not falsy) handling so explicit 0 temperature/token counts survive.
  const num = (key: string): number | undefined => {
    const value = actionContext[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  };
  const purpose = str('purpose');
  trajectoryLogger.logLLMCall(stepId, {
    model: str('model') ?? 'unknown',
    systemPrompt: str('systemPrompt') ?? '',
    userPrompt: str('userPrompt') ?? '',
    response: str('response') ?? '',
    reasoning: str('reasoning'),
    temperature: num('temperature') ?? 0.7,
    maxTokens: num('maxTokens') ?? 8192,
    purpose:
      purpose === 'action' ||
      purpose === 'reasoning' ||
      purpose === 'evaluation' ||
      purpose === 'response' ||
      purpose === 'other'
        ? purpose
        : 'action',
    actionType: str('actionType'),
    promptTokens: num('promptTokens'),
    completionTokens: num('completionTokens'),
    latencyMs: num('latencyMs'),
  });
}

/**
 * Log provider access from action context
 */
export function logProviderFromAction(
  actionContext: Record<string, JsonValue | undefined>,
  trajectoryLogger: RuntimeTrajectoryLogger,
  trajectoryId: string
): void {
  const stepId = trajectoryLogger.getCurrentStepId(trajectoryId);
  if (!stepId) {
    logger.warn('No active step for provider access from action', {
      trajectoryId,
    });
    return;
  }

  trajectoryLogger.logProviderAccess(stepId, {
    providerName: (actionContext.providerName as string) || 'unknown',
    data:
      (actionContext.data as Record<string, JsonValue>) ||
      ({} as Record<string, JsonValue>),
    purpose: (actionContext.purpose as string) || 'action',
    query: (actionContext.query as Record<string, JsonValue>) || undefined,
  });
}

/**
 * Wrap a provider with trajectory logging
 */
export function wrapProviderWithLogging(
  provider: import('@elizaos/core').Provider,
  _trajectoryLogger: RuntimeTrajectoryLogger
): import('@elizaos/core').Provider {
  const originalGet = provider.get;

  return {
    ...provider,
    get: async (
      runtime: IAgentRuntime,
      message: Memory,
      state: State
    ): Promise<import('@elizaos/core').ProviderResult> => {
      const activeStep = await ensureTrajectoryStep(runtime);
      if (!activeStep) {
        // No trajectory context - execute without logging
        return originalGet?.(runtime, message, state) || { text: '' };
      }

      const { logger: loggerService, stepId } = activeStep;

      const result = (await originalGet?.(runtime, message, state)) || {
        text: '',
      };
      // Log provider access on success
      loggerService.logProviderAccess(stepId, {
        providerName: provider.name,
        data: {
          text: result.text || '',
          success: true,
        },
        purpose: `Provider ${provider.name} accessed for context`,
        query: {
          message: message.content.text || '',
          state: state ? JSON.parse(JSON.stringify(state)) : undefined,
        },
      });

      return result;
    },
  };
}

/**
 * Wrap all plugin providers with trajectory logging
 */
export function wrapPluginProviders(
  plugin: Plugin,
  trajectoryLogger: RuntimeTrajectoryLogger
): Plugin {
  if (!plugin.providers || plugin.providers.length === 0) {
    return plugin;
  }

  return {
    ...plugin,
    providers: plugin.providers.map((provider) =>
      wrapProviderWithLogging(provider, trajectoryLogger)
    ),
  };
}
