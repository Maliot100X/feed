import { expect, test } from 'bun:test';
import type { Action, IAgentRuntime, Memory } from '@elizaos/core';
import {
  logLLMCallFromAction,
  type RuntimeTrajectoryLogger,
  setTrajectoryContext,
  wrapActionWithLogging,
} from '../../agents/src/plugins/plugin-trajectory-logger/src/action-interceptor';

test('action instrumentation preserves results and records explicit failures without inventing success', async () => {
  const runtime = {} as IAgentRuntime;
  const records: Array<Parameters<RuntimeTrajectoryLogger['completeStep']>[2]> =
    [];
  const logger: RuntimeTrajectoryLogger = {
    startStep: () => 'step',
    getCurrentStepId: () => 'step',
    logLLMCall: () => {},
    logProviderAccess: () => {},
    completeStep: (_trajectory, _step, action) => {
      records.push(action);
    },
  };
  const result = {
    success: false,
    error: 'Order rejected',
    data: { marketId: 'exact-market' },
  };
  const action: Action = {
    name: 'TRADE',
    description: 'Trade',
    validate: async () => true,
    handler: async () => result,
  };
  const wrapped = wrapActionWithLogging(action, logger);
  const message = { content: { text: 'trade request' } } as Memory;
  expect(await wrapped.handler(runtime, message)).toBe(result);
  setTrajectoryContext(runtime, 'trajectory', logger);
  expect(await wrapped.handler(runtime, message)).toBe(result);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    success: false,
    error: 'Order rejected',
    result: { data: { marketId: 'exact-market' } },
  });
  const missing = wrapActionWithLogging(
    { ...action, handler: async () => undefined },
    logger
  );
  await expect(missing.handler(runtime, message)).rejects.toThrow(
    'no explicit outcome'
  );
  expect(records.at(-1)?.success).toBe(false);
});

test('LLM call logging keeps explicit zero temperature and token counts', () => {
  const calls: Array<Parameters<RuntimeTrajectoryLogger['logLLMCall']>[1]> = [];
  const logger: RuntimeTrajectoryLogger = {
    startStep: () => 'step',
    getCurrentStepId: () => 'step',
    logLLMCall: (_step, call) => {
      calls.push(call);
    },
    logProviderAccess: () => {},
    completeStep: () => {},
  };
  logLLMCallFromAction(
    { model: 'm', temperature: 0, promptTokens: 0, completionTokens: 0 },
    logger,
    'trajectory'
  );
  expect(calls[0]).toMatchObject({
    model: 'm',
    temperature: 0,
    promptTokens: 0,
    completionTokens: 0,
  });
});
