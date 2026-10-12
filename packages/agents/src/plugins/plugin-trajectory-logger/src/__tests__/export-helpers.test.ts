import { describe, expect, it } from 'bun:test';
import {
  assertValidDatasetName,
  resolveMaxTrajectories,
  splitDataset,
  toSafeFileSegment,
} from '../export';

describe('trajectory export helpers', () => {
  it('rejects dataset names that could inject shell arguments', () => {
    expect(() => assertValidDatasetName('FeedSocial/agent-traj')).not.toThrow();
    for (const name of [
      'owner/name; rm -rf /',
      '--repo-type model',
      'no-owner',
      'owner/$(whoami)',
    ]) {
      expect(() => assertValidDatasetName(name)).toThrow(
        'Invalid Hugging Face dataset name'
      );
    }
  });

  it('maps identifiers to safe single path segments', () => {
    expect(toSafeFileSegment('../../etc/passwd')).toBe('______etc_passwd');
    expect(toSafeFileSegment('scenario-1_a')).toBe('scenario-1_a');
    expect(() => toSafeFileSegment('')).toThrow();
  });

  it('validates maxTrajectories instead of silently defaulting 0', () => {
    expect(resolveMaxTrajectories(undefined, 10)).toBe(10);
    expect(resolveMaxTrajectories(5, 10)).toBe(5);
    for (const value of [0, -1, 1.5, Number.NaN]) {
      expect(() => resolveMaxTrajectories(value, 10)).toThrow(
        'maxTrajectories must be a positive integer'
      );
    }
  });

  it('validates split ratios and keeps every row exactly once', () => {
    const data = Array.from({ length: 10 }, (_, i) => i);
    const splits = splitDataset(data, {
      train: 0.6,
      validation: 0.2,
      test: 0.2,
    });
    expect(splits.train).toHaveLength(6);
    expect(splits.validation).toHaveLength(2);
    expect(
      [...splits.train, ...splits.validation, ...splits.test].sort(
        (a, b) => a - b
      )
    ).toEqual(data);

    expect(() =>
      splitDataset(data, { train: 0.9, validation: 0.2, test: 0.2 })
    ).toThrow('must sum to 1');
    expect(() =>
      splitDataset(data, { train: Number.NaN, validation: 0.5, test: 0.5 })
    ).toThrow('non-negative number');
  });
});
