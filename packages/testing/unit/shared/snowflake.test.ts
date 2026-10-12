/**
 * Snowflake ID Generator Unit Tests
 * Tests for the shared package's Snowflake ID utilities
 */

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  isValidSnowflakeId,
  parseSnowflakeId,
  SnowflakeGenerator,
} from '../../../shared/src/utils/snowflake';

const EPOCH_MS = 1704067200000;

describe('Snowflake ID Generator', () => {
  afterEach(() => {
    // Restore any Date.now spy installed by a test.
    mock.restore();
  });

  describe('generate', () => {
    it('generates strictly increasing decimal IDs with exact components', async () => {
      const generator = new SnowflakeGenerator(777);
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        ids.push(await generator.generate());
      }

      const values = ids.map((id) => {
        expect(id).toMatch(/^\d+$/);
        return BigInt(id);
      });
      for (let i = 1; i < values.length; i++) {
        expect(values[i]! > values[i - 1]!).toBe(true);
      }
      for (const id of ids) {
        expect(parseSnowflakeId(id).workerId).toBe(777);
      }
    });

    it('uses the clock timestamp and increments sequence within a millisecond', async () => {
      const now = EPOCH_MS + 10_000;
      spyOn(Date, 'now').mockReturnValue(now);
      const generator = new SnowflakeGenerator(3);

      const first = parseSnowflakeId(await generator.generate());
      const second = parseSnowflakeId(await generator.generate());

      expect(first.timestamp.getTime()).toBe(now);
      expect(first.sequence).toBe(0);
      expect(second.timestamp.getTime()).toBe(now);
      expect(second.sequence).toBe(1);
    });

    it('produces unique IDs for concurrent callers', async () => {
      const generator = new SnowflakeGenerator(1);
      const ids = await Promise.all(
        Array.from({ length: 500 }, () => generator.generate())
      );
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('rejects on clock rollback and recovers once the clock catches up', async () => {
      const clock = spyOn(Date, 'now');
      const generator = new SnowflakeGenerator(5);

      clock.mockReturnValue(EPOCH_MS + 5_000);
      const before = BigInt(await generator.generate());

      clock.mockReturnValue(EPOCH_MS + 4_000);
      await expect(generator.generate()).rejects.toThrow(
        'Clock moved backwards'
      );

      clock.mockReturnValue(EPOCH_MS + 6_000);
      const after = await Promise.race([
        generator.generate(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('generator wedged')), 500)
        ),
      ]);
      expect(BigInt(after) > before).toBe(true);
      expect(parseSnowflakeId(after).timestamp.getTime()).toBe(
        EPOCH_MS + 6_000
      );
    });

    it('rejects invalid worker IDs', () => {
      expect(() => new SnowflakeGenerator(-1)).toThrow();
      expect(() => new SnowflakeGenerator(1024)).toThrow();
      expect(() => new SnowflakeGenerator(1.5)).toThrow();
      expect(() => new SnowflakeGenerator(Number.NaN)).toThrow();
      expect(() => new SnowflakeGenerator(1023)).not.toThrow();
    });
  });

  describe('isValidSnowflakeId', () => {
    it('accepts generated IDs and numeric strings in range', async () => {
      const id = await new SnowflakeGenerator(0).generate();
      expect(isValidSnowflakeId(id)).toBe(true);
      expect(isValidSnowflakeId('123456789012345')).toBe(true);
      expect(isValidSnowflakeId('1')).toBe(true);
    });

    it('rejects non-numeric, fractional, empty and out-of-range IDs', () => {
      expect(isValidSnowflakeId('invalid')).toBe(false);
      expect(isValidSnowflakeId('abc123')).toBe(false);
      expect(isValidSnowflakeId('12.34')).toBe(false);
      expect(isValidSnowflakeId('')).toBe(false);
      expect(isValidSnowflakeId('9223372036854775808')).toBe(false); // 2^63
    });
  });

  describe('parseSnowflakeId', () => {
    it('parses string and bigint forms identically', async () => {
      const id = await new SnowflakeGenerator(42).generate();
      expect(parseSnowflakeId(id)).toEqual(parseSnowflakeId(BigInt(id)));
      expect(parseSnowflakeId(id).workerId).toBe(42);
    });
  });
});
