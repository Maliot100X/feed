import { describe, expect, test } from 'bun:test';
import { MAX_DISPATCHES, validateDispatches } from '../dispatch-validation';

describe('validateDispatches', () => {
  test('accepts a well-formed list and trims values', () => {
    expect(
      validateDispatches([
        { agentId: ' a1 ', command: ' buy ' },
        { agentId: 'a2', command: 'post' },
      ])
    ).toEqual({
      ok: true,
      dispatches: [
        { agentId: 'a1', command: 'buy' },
        { agentId: 'a2', command: 'post' },
      ],
    });
  });

  test('null or malformed entries reject the request instead of throwing/dropping', () => {
    expect(validateDispatches([null]).ok).toBe(false);
    expect(validateDispatches([{ agentId: 'a1', command: '' }]).ok).toBe(false);
    expect(validateDispatches([{ agentId: 1, command: 'x' }]).ok).toBe(false);
    expect(validateDispatches('nope').ok).toBe(false);
    expect(validateDispatches([]).ok).toBe(false);
  });

  test('rejects more than MAX_DISPATCHES instead of silently truncating', () => {
    const many = Array.from({ length: MAX_DISPATCHES + 1 }, (_, i) => ({
      agentId: `a${i}`,
      command: 'go',
    }));
    expect(validateDispatches(many).ok).toBe(false);
  });

  test('rejects duplicate agents', () => {
    expect(
      validateDispatches([
        { agentId: 'a1', command: 'x' },
        { agentId: 'a1', command: 'y' },
      ]).ok
    ).toBe(false);
  });
});
