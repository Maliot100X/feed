import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { BiasEngine } from '../../feedback/bias-engine';

const engine = BiasEngine.getInstance();

describe('BiasEngine', () => {
  afterEach(() => {
    setSystemTime();
    engine.importBiases([]);
  });

  test('rejects non-finite strength and out-of-range decay/duration', () => {
    expect(() => engine.setBias('e', 'E', 'up', Number.NaN)).toThrow(
      RangeError
    );
    expect(() =>
      engine.setBias('e', 'E', 'up', 0.5, { decayRate: -1 })
    ).toThrow(RangeError);
    expect(() =>
      engine.setBias('e', 'E', 'up', 0.5, {
        durationHours: Number.POSITIVE_INFINITY,
      })
    ).toThrow(RangeError);
    expect(engine.getActiveBiases()).toEqual([]);
  });

  test('expired biases are never reported active (exact boundary)', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    setSystemTime(start);
    engine.setBias('e', 'E', 'up', 0.5, { durationHours: 1 });
    expect(engine.getActiveBiases()).toHaveLength(1);
    setSystemTime(new Date(start.getTime() + 60 * 60 * 1000));
    expect(engine.getActiveBiases()).toEqual([]);
  });

  test('returned biases are copies and invalid imports change nothing', () => {
    engine.setBias('e', 'E', 'up', 0.5);
    const [copy] = engine.getActiveBiases();
    if (!copy) throw new Error('expected a bias');
    copy.strength = 1;
    expect(engine.getActiveBiases()[0]?.strength).toBe(0.5);

    expect(() =>
      engine.importBiases([{ ...copy, decayRate: Number.NaN }])
    ).toThrow(RangeError);
    expect(engine.getActiveBiases()[0]?.strength).toBe(0.5);
  });
});
