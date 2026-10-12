import { describe, expect, it } from 'bun:test';
import { sanitizeForJson } from './sanitize';

describe('sanitizeForJson', () => {
  it('converts bigints and dates', () => {
    const date = new Date('2024-01-02T03:04:05.000Z');
    expect(sanitizeForJson({ n: 10n, at: date })).toEqual({
      n: '10',
      at: '2024-01-02T03:04:05.000Z',
    });
  });

  it('terminates on a self-referencing array', () => {
    const list: unknown[] = [1];
    list.push(list);
    expect(sanitizeForJson(list)).toEqual([1, null]);
  });

  it('terminates on an object -> array -> object cycle', () => {
    const node: { children: unknown[] } = { children: [] };
    node.children.push(node);
    expect(sanitizeForJson(node)).toEqual({ children: [null] });
  });

  it('keeps shared non-circular references in every position', () => {
    const shared = { id: 'x' };
    expect(sanitizeForJson({ a: shared, b: shared, list: [shared] })).toEqual({
      a: { id: 'x' },
      b: { id: 'x' },
      list: [{ id: 'x' }],
    });
  });
});
