import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveAgentInferenceProvider } from '../direct-groq';

const KEYS = ['SURPLUS_API_KEY', 'ELIZACLOUD_API_KEY', 'GROQ_API_KEY'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveAgentInferenceProvider', () => {
  test('labels the provider that the client actually routes to', () => {
    process.env.GROQ_API_KEY = 'g';
    expect(resolveAgentInferenceProvider()).toBe('groq');

    process.env.ELIZACLOUD_API_KEY = 'e';
    expect(resolveAgentInferenceProvider()).toBe('elizacloud');

    process.env.SURPLUS_API_KEY = 's';
    expect(resolveAgentInferenceProvider()).toBe('surplus');
  });
});
