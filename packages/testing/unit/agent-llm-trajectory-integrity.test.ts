import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getAgentLLMBridge } from '@feed/shared';
import OpenAI from 'openai';
import { callAgentLLM } from '../../agents/src/llm/agent-llm';
import { callGroqDirect } from '../../agents/src/llm/direct-groq';
import {
  installLLMInterceptor,
  setLLMCallCallback,
  uninstallLLMInterceptor,
} from '../../engine/src/dag-trace/llm-interceptor';
import type { LLMCallInput } from '../../engine/src/dag-trace/types';
import {
  FeedLLMClient,
  setTokenUsageCallback,
  type TokenUsageCallback,
} from '../../engine/src/llm/openai-client';
import { tracedCompletion } from '../../engine/src/llm/traced-completion';

const calls: LLMCallInput[] = [];
const requests: Array<{ messages: Array<{ role: string; content: string }> }> =
  [];
const requestPaths: string[] = [];
const saved = { ...process.env };
let responseText = 'A model response';
let status = 200;
let queuedResponses: Array<{
  content: string;
  finish: string;
  status?: number;
}> = [];
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    requestPaths.push(new URL(request.url).pathname);
    requests.push(await request.json());
    if (status !== 200)
      return Response.json(
        { error: { message: 'Controlled provider failure' } },
        { status }
      );
    const next = queuedResponses.shift() ?? {
      content: responseText,
      finish: 'stop',
    };
    if (next.status) {
      return Response.json(
        { error: { message: 'Controlled continuation failure' } },
        { status: next.status, headers: { 'x-should-retry': 'false' } }
      );
    }
    return Response.json({
      id: 'audit-call',
      object: 'chat.completion',
      created: 1,
      model: 'audit-model',
      choices: [
        {
          index: 0,
          finish_reason: next.finish,
          message: { role: 'assistant', content: next.content },
        },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
    });
  },
});

beforeAll(() => {
  process.env.GROQ_API_KEY = 'local-test-only';
  process.env.GROQ_BASE_URL = `${server.url}v1`;
  delete process.env.ELIZACLOUD_API_KEY;
  installLLMInterceptor();
  setLLMCallCallback((call) => calls.push(call));
});
afterAll(() => {
  uninstallLLMInterceptor();
  process.env = saved;
  server.stop(true);
});

describe('actual provider transport and trajectory bridge', () => {
  test('raw helper calls capture success, provider failure and empty output', async () => {
    const client = new OpenAI({
      apiKey: 'local-test-only',
      baseURL: `${server.url}v1`,
      maxRetries: 0,
    });
    const params = {
      model: 'audit-model',
      messages: [{ role: 'user' as const, content: 'Full tag context' }],
      temperature: 0.3,
      max_tokens: 100,
    };
    const initial = calls.length;
    await tracedCompletion(client, 'groq', 'tag_generation', params);
    expect(calls.at(-1)).toMatchObject({
      userPrompt: 'Full tag context',
      messages: params.messages,
      success: true,
      totalTokens: 40,
    });
    status = 400;
    await expect(
      tracedCompletion(client, 'groq', 'tag_generation', params)
    ).rejects.toThrow();
    expect(calls.at(-1)?.success).toBe(false);
    status = 200;
    responseText = '';
    await expect(
      tracedCompletion(client, 'groq', 'tag_generation', params)
    ).rejects.toThrow('empty');
    expect(calls.at(-1)?.success).toBe(false);
    expect(calls.length - initial).toBe(3);
    responseText = 'A model response';
  });
  test('captures exact prompts and token usage without an active game tick', async () => {
    expect(getAgentLLMBridge()).not.toBeNull();
    const prompt = 'Required information: $& {{literal_user_text}}';
    const system = 'Keep the NPC identity and full conversation';
    expect(await callGroqDirect({ prompt, system, maxTokens: 100 })).toBe(
      responseText
    );
    expect(requests.at(-1)?.messages).toEqual([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ]);
    expect(calls.at(-1)).toMatchObject({
      systemPrompt: system,
      userPrompt: prompt,
      rawResponse: responseText,
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      success: true,
    });
  });
  test('captures failed HTTP calls and propagates the failure', async () => {
    status = 400;
    await expect(callGroqDirect({ prompt: 'failure input' })).rejects.toThrow();
    expect(calls.at(-1)).toMatchObject({
      userPrompt: 'failure input',
      success: false,
    });
    status = 200;
  });
  test('rejects and records empty model content', async () => {
    responseText = '';
    await expect(
      callGroqDirect({ prompt: 'empty response input' })
    ).rejects.toThrow('empty');
    expect(calls.at(-1)).toMatchObject({
      success: false,
      userPrompt: 'empty response input',
    });
  });
  test('does not silently choose Groq for an unknown configured provider', async () => {
    process.env.AGENT_LLM_PROVIDER = 'typo-provider';
    await expect(callAgentLLM({ prompt: 'input' })).rejects.toThrow(
      'Unsupported'
    );
  });
  test('records every engine continuation with its exact conversation', async () => {
    const before = calls.length;
    queuedResponses = [
      { content: '{"items":[', finish: 'length' },
      { content: '1]}', finish: 'stop' },
    ];
    const client = new FeedLLMClient(undefined, 'groq');
    expect(
      await client.generateJSON<{ items: number[] }>(
        'Generate items',
        undefined,
        {
          format: 'json',
          maxTokens: 100,
        }
      )
    ).toEqual({ items: [1] });
    const captured = calls.slice(before);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.rawResponse).toBe('{"items":[');
    expect(captured[1]?.rawResponse).toBe('1]}');
    expect(captured[1]?.messages?.[2]).toEqual({
      role: 'assistant',
      content: '{"items":[',
    });
    expect(captured[1]?.messages?.[3]?.content).toContain('JSON');
    expect(captured.reduce((sum, call) => sum + call.totalTokens, 0)).toBe(80);
  });
  test('token totals retain consumed continuation tokens when an engine attempt retries', async () => {
    const usage: Array<Parameters<TokenUsageCallback>[0]> = [];
    const before = calls.length;
    queuedResponses = [
      { content: '{"items":[', finish: 'length' },
      { content: '', finish: 'stop', status: 503 },
      { content: '{"items":[1]}', finish: 'stop' },
    ];
    setTokenUsageCallback((call) => usage.push(call));
    try {
      const client = new FeedLLMClient(undefined, 'groq');
      expect(
        await client.generateJSON<{ items: number[] }>(
          'Generate items',
          undefined,
          {
            format: 'json',
            maxTokens: 100,
          }
        )
      ).toEqual({ items: [1] });
      expect(calls.slice(before)).toHaveLength(3);
      expect(usage.map((call) => call.success)).toEqual([false, true]);
      expect(usage.reduce((sum, call) => sum + call.inputTokens, 0)).toBe(60);
      expect(usage.reduce((sum, call) => sum + call.outputTokens, 0)).toBe(20);
      expect(usage.reduce((sum, call) => sum + call.totalTokens, 0)).toBe(80);
    } finally {
      setTokenUsageCallback(null);
    }
  }, 15000);
  test('malformed engine XML is a failed trajectory with raw output and usage preserved', async () => {
    responseText =
      '<decisions><decision><npcId>org-example</npcName></decision></decisions>';
    const before = calls.length;
    const client = new FeedLLMClient(undefined, 'groq');
    await expect(
      client.generateJSON('Required market context')
    ).rejects.toThrow('Failed to parse XML');
    expect(calls.slice(before)).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({
      success: false,
      rawResponse: responseText,
      userPrompt: 'Required market context',
      totalTokens: 40,
      parsedResponse: null,
    });
    expect(calls.at(-1)?.error).toContain('Mismatched XML');
  });
  test('captures engine transport failure with the exact prompt', async () => {
    status = 400;
    const client = new FeedLLMClient(undefined, 'groq');
    await expect(client.generateJSON('engine failure input')).rejects.toThrow();
    expect(calls.at(-1)).toMatchObject({
      userPrompt: 'engine failure input',
      success: false,
    });
    status = 200;
  });
  test('HuggingFace retains system context, avoids doubled v1 paths, and exposes failures', async () => {
    const before = { ...process.env };
    try {
      process.env.AGENT_LLM_PROVIDER = 'huggingface';
      process.env.HUGGINGFACE_API_KEY = 'local-test-only';
      process.env.HUGGINGFACE_MODEL_ENDPOINT = `${server.url}v1`;
      process.env.HUGGINGFACE_API_FORMAT = 'openai';
      process.env.HUGGINGFACE_MODEL_NAME = 'configured-model';
      responseText = 'HF response';
      await callAgentLLM({
        prompt: 'Required user context',
        system: 'Required character system',
      });
      expect(requestPaths.at(-1)).toBe('/v1/chat/completions');
      expect(requests.at(-1)?.messages).toEqual([
        { role: 'system', content: 'Required character system' },
        { role: 'user', content: 'Required user context' },
      ]);
      expect(calls.at(-1)).toMatchObject({
        provider: 'huggingface',
        model: 'configured-model',
        success: true,
      });
      const count = requests.length;
      status = 503;
      await expect(callAgentLLM({ prompt: 'fail visibly' })).rejects.toThrow(
        '503'
      );
      expect(requests.length - count).toBe(1);
      expect(calls.at(-1)).toMatchObject({
        success: false,
        userPrompt: 'fail visibly',
      });
    } finally {
      process.env = before;
      status = 200;
      responseText = 'A model response';
    }
  });
  test('does not hide capture callback failures', async () => {
    responseText = 'valid response';
    setLLMCallCallback(() => {
      throw new Error('Capture storage failed');
    });
    await expect(callGroqDirect({ prompt: 'capture failure' })).rejects.toThrow(
      'Capture storage failed'
    );
  });
});
