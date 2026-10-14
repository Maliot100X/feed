import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveLiveLlmTestConfig } from '../integration/helpers/live-runtime';

const credentialNames = [
  'SURPLUS_API_KEY',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
] as const;
const saved = { ...process.env };

beforeEach(() => {
  delete process.env.RUN_LIVE_LLM_TESTS;
  for (const name of credentialNames) delete process.env[name];
});
afterEach(() => {
  process.env = { ...saved };
});

describe('Live inference opt-in', () => {
  test('does not enable paid inference merely because credentials exist', () => {
    process.env.SURPLUS_API_KEY = 'test-credential';
    expect(resolveLiveLlmTestConfig()).toMatchObject({
      requested: false,
      enabled: false,
    });
  });

  for (const name of credentialNames) {
    test('accepts an opted-in ' + name + ' configuration', () => {
      process.env.RUN_LIVE_LLM_TESTS = '1';
      process.env[name] = 'test-credential';
      expect(resolveLiveLlmTestConfig()).toEqual({
        requested: true,
        enabled: true,
        skipReason: null,
      });
    });
  }

  test('requires a non-empty credential after opt-in', () => {
    process.env.RUN_LIVE_LLM_TESTS = 'true';
    for (const name of credentialNames) process.env[name] = '  ';
    expect(resolveLiveLlmTestConfig()).toMatchObject({
      requested: true,
      enabled: false,
    });
  });
});
