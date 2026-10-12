import { describe, expect, it } from 'bun:test';
import { generateWorldActors } from '../prompts/world-context';

const listed = (output: string) =>
  output
    .replace('World Actors (USE THESE NAMES ONLY): ', '')
    .split(', ')
    .filter(Boolean);

describe('generateWorldActors', () => {
  it('treats 0 as no actors instead of unlimited', () => {
    expect(listed(generateWorldActors(0))).toHaveLength(0);
  });

  it('limits to the requested count', () => {
    expect(listed(generateWorldActors(2))).toHaveLength(2);
  });

  it('rejects negative or fractional limits', () => {
    expect(() => generateWorldActors(-1)).toThrow('non-negative integer');
    expect(() => generateWorldActors(1.5)).toThrow('non-negative integer');
  });
});
