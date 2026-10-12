import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualShared from '@feed/shared';

const KEYS = [
  'ELIZACLOUD_API_KEY',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
] as const;
const saved: Partial<Record<(typeof KEYS)[number], string>> = {};

let llmResponse: object = { message: 'ok', status: 'ok' };
const forGameTick = mock(() => ({
  getStats: () => ({ provider: 'elizacloud', model: 'gpt-5-nano' }),
  generateJSON: async () => llmResponse,
}));

mock.module('@feed/shared', () => ({
  ...actualShared,
  getSurplusConfig: () => null,
}));

mock.module('@feed/engine', () => ({
  FeedLLMClient: { forGameTick },
}));

mock.module('@feed/api', () => ({
  getClientIp: () => null,
  logAdminModify: async () => undefined,
  logAdminView: async () => undefined,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const config = (await import('../route')).GET;
const test = (await import('../test/route')).POST;

const req = () => new Request('http://localhost/api/admin/ai-models') as never;

describe('admin ai-models', () => {
  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    forGameTick.mockClear();
    llmResponse = { message: 'ok', status: 'ok' };
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('reports no active provider when nothing is configured', async () => {
    const body = await ((await config(req())) as Response).json();
    expect(body.data.activeProvider).toBeNull();
    expect(body.data.recommendedModels).toEqual([]);
    expect(forGameTick).not.toHaveBeenCalled();
  });

  it('reports the provider the game-tick client actually selects', async () => {
    process.env.ELIZACLOUD_API_KEY = 'test-key';
    const body = await ((await config(req())) as Response).json();
    expect(body.data.providers.elizacloud).toBe(true);
    expect(body.data.activeProvider).toBe('elizacloud');
    expect(body.data.activeModel).toBe('gpt-5-nano');
  });

  it('test endpoint fails when the model returns the wrong shape', async () => {
    llmResponse = { response: { message: 'hi', status: 'ok' } };
    const res = (await test(req())) as Response;
    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });

  it('test endpoint fails when status is not ok', async () => {
    llmResponse = { message: 'hi', status: 'error' };
    expect(((await test(req())) as Response).status).toBe(502);
  });

  it('test endpoint succeeds on a valid response', async () => {
    const res = (await test(req())) as Response;
    expect(res.status).toBe(200);
    expect((await res.json()).data.response).toEqual({
      message: 'ok',
      status: 'ok',
    });
  });
});
