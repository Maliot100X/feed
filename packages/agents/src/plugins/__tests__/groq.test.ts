import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { IAgentRuntime } from '@elizaos/core';

const mockLanguageModel = mock((model: string) => `language-model:${model}`);
const mockCreateGroq = mock(() => ({
  languageModel: mockLanguageModel,
}));
const mockGenerateText = mock(async () => ({
  text: 'mocked response',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
}));
const mockGenerateObject = mock(async () => ({
  object: { ok: true },
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
}));
const mockLogPrompt = mock(async () => undefined);

mock.module('@ai-sdk/groq', () => ({
  createGroq: mockCreateGroq,
}));

mock.module('ai', () => ({
  generateObject: mockGenerateObject,
  jsonSchema: (schema: object) => schema,
  generateText: mockGenerateText,
}));

mock.module('@feed/engine/embedding', () => ({
  getEmbedding: mock(async () => [0.1, 0.2]),
}));

mock.module('@feed/shared', () => ({
  getSurplusConfig: () => null,
  getAgentLLMBridge: () => undefined,
  GROQ_MODELS: {
    FREE: { modelId: 'groq-small-model' },
    PRO: { modelId: 'groq-large-model' },
  },
}));

mock.module('@elizaos/core', () => ({
  ModelType: {
    TEXT_EMBEDDING: 'text_embedding',
    OBJECT_LARGE: 'object_large',
    OBJECT_SMALL: 'object_small',
    TEXT_LARGE: 'text_large',
    TEXT_SMALL: 'text_small',
    TEXT_TOKENIZER_DECODE: 'text_tokenizer_decode',
    TEXT_TOKENIZER_ENCODE: 'text_tokenizer_encode',
  },
}));

mock.module('../../shared/logger', () => ({
  logger: {
    debug: mock(),
    error: mock(),
    info: mock(),
    warn: mock(),
  },
}));

mock.module('../../utils/prompt-logger', () => ({
  isPromptLoggingEnabled: () => false,
  logPrompt: mockLogPrompt,
}));

const { ModelType } = await import('@elizaos/core');
const { groqPlugin } = await import('../groq');

const runtime = {
  character: { system: 'System prompt' },
  fetch: undefined,
  getSetting: (key: string) => {
    if (key === 'GROQ_API_KEY') return 'test-groq-key';
    if (key === 'GROQ_BASE_URL') return 'https://groq.example';
    return undefined;
  },
} as unknown as IAgentRuntime;

const runtimeWithModelOverride = {
  character: { system: 'System prompt' },
  fetch: undefined,
  getSetting: (key: string) => {
    if (key === 'GROQ_API_KEY') return 'test-groq-key';
    if (key === 'GROQ_BASE_URL') return 'https://proxy.example/v1';
    if (key === 'GROQ_SMALL_MODEL') return 'proxy-small';
    if (key === 'GROQ_LARGE_MODEL') return 'proxy-large';
    if (key === 'GROQ_PRIMARY_MODEL') return 'proxy-primary';
    return undefined;
  },
} as unknown as IAgentRuntime;

describe('groqPlugin TEXT_SMALL', () => {
  beforeEach(() => {
    mockCreateGroq.mockClear();
    mockLanguageModel.mockClear();
    mockGenerateText.mockClear();
    mockGenerateObject.mockClear();
    mockLogPrompt.mockClear();
  });

  it('passes caller-provided generation params through to Groq', async () => {
    const response = await groqPlugin.models[ModelType.TEXT_SMALL]?.(runtime, {
      frequencyPenalty: 0.2,
      maxTokens: 321,
      presencePenalty: 0.1,
      prompt: 'tell my agent to buy TSLAI',
      stopSequences: ['</response>'],
      temperature: 0.4,
    });

    expect(response).toBe('mocked response');
    expect(mockCreateGroq).toHaveBeenCalledWith({
      apiKey: 'test-groq-key',
      baseURL: 'https://groq.example',
      fetch: undefined,
    });
    expect(mockLanguageModel).toHaveBeenCalledWith('groq-small-model');
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        frequencyPenalty: 0.2,
        maxOutputTokens: 321,
        model: 'language-model:groq-small-model',
        presencePenalty: 0.1,
        prompt: 'tell my agent to buy TSLAI',
        stopSequences: ['</response>'],
        system: 'System prompt',
        temperature: 0.4,
      })
    );
  });

  it('keeps the previous defaults when caller params are omitted', async () => {
    await groqPlugin.models[ModelType.TEXT_SMALL]?.(runtime, {
      prompt: 'default params',
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        frequencyPenalty: 0.7,
        maxOutputTokens: 8000,
        presencePenalty: 0.7,
        prompt: 'default params',
        stopSequences: [],
        temperature: 0.7,
      })
    );
  });

  it('uses runtime model overrides for small and large routes', async () => {
    await groqPlugin.models[ModelType.TEXT_SMALL]?.(runtimeWithModelOverride, {
      prompt: 'small route',
    });
    await groqPlugin.models[ModelType.TEXT_LARGE]?.(runtimeWithModelOverride, {
      prompt: 'large route',
    });

    expect(mockCreateGroq).toHaveBeenCalledWith({
      apiKey: 'test-groq-key',
      baseURL: 'https://proxy.example/v1',
      fetch: undefined,
    });
    expect(mockLanguageModel).toHaveBeenCalledWith('proxy-small');
    expect(mockLanguageModel).toHaveBeenCalledWith('proxy-large');
  });
});

it('passes system, schema and limits to object generation', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
  await groqPlugin.models[ModelType.OBJECT_LARGE]?.(runtime, {
    prompt: 'make a decision',
    schema,
    maxTokens: 123,
    temperature: 0.3,
  });
  expect(mockGenerateObject).toHaveBeenCalledWith(
    expect.objectContaining({
      system: 'System prompt',
      prompt: 'make a decision',
      schema,
      maxOutputTokens: 123,
      maxRetries: 0,
    })
  );
});

it('records failed text and object requests in the active training step', async () => {
  const { setTrajectoryContext, clearTrajectoryContext } = await import(
    '../plugin-trajectory-logger/src/action-interceptor'
  );
  const logLLMCall = mock();
  setTrajectoryContext(runtime, 'audit-trajectory', {
    startStep: () => 'audit-step',
    getCurrentStepId: () => 'audit-step',
    logLLMCall,
    logProviderAccess: () => {},
    completeStep: () => {},
  });
  try {
    mockGenerateText.mockRejectedValueOnce(new Error('text provider failed'));
    await expect(
      groqPlugin.models![ModelType.TEXT_SMALL]!(runtime, {
        prompt: 'retain failed text context',
      })
    ).rejects.toThrow('text provider failed');
    expect(logLLMCall.mock.calls.at(-1)?.[1]).toMatchObject({
      userPrompt: 'retain failed text context',
      metadata: { success: false, error: 'text provider failed' },
    });
    mockGenerateObject.mockRejectedValueOnce(
      new Error('object provider failed')
    );
    await expect(
      groqPlugin.models![ModelType.OBJECT_SMALL]!(runtime, {
        prompt: 'retain failed object context',
      })
    ).rejects.toThrow('object provider failed');
    expect(logLLMCall.mock.calls.at(-1)?.[1]).toMatchObject({
      userPrompt: 'retain failed object context',
      metadata: { success: false, error: 'object provider failed' },
    });
  } finally {
    clearTrajectoryContext(runtime);
  }
});
