/**
 * Shared environment-variable parsers for engine configuration modules.
 *
 * Every parser returns the default when the variable is unset/blank, and
 * warns (tagged with the owning config scope) and returns the default when a
 * set value is invalid — non-numeric, non-finite, out of range, fractional
 * where an integer is required, or an unrecognized boolean.
 */

import { logger } from '@feed/shared';
import { clamp01 } from '../utils/math-utils';

export interface EnvParsers {
  /** Any finite number. */
  number(key: string, defaultValue: number): number;
  /** Finite number > 0. */
  positiveNumber(key: string, defaultValue: number): number;
  /** Finite number >= 0 (0 is valid, e.g. to disable a feature). */
  nonNegativeNumber(key: string, defaultValue: number): number;
  /** Integer >= 1 (counts, limits, batch sizes). */
  positiveInt(key: string, defaultValue: number): number;
  /** Probability/score in [0, 1]; out-of-range values are clamped. */
  probability(key: string, defaultValue: number): number;
  /** true/false, 1/0, yes/no (case-insensitive). */
  boolean(key: string, defaultValue: boolean): boolean;
  /** One of an explicit set of allowed numeric values. */
  oneOf<T extends number>(
    key: string,
    allowed: readonly T[],
    defaultValue: T
  ): T;
}

export function createEnvParsers(scope: string): EnvParsers {
  const warnDefault = (
    key: string,
    value: string | number,
    requirement: string,
    defaultValue: number | boolean
  ) => {
    logger.warn(
      `${key}=${value} ${requirement}, using default ${defaultValue}`,
      { key, value, defaultValue },
      scope
    );
  };

  const raw = (key: string): string | undefined => {
    const value = process.env[key]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };

  const number = (key: string, defaultValue: number): number => {
    const value = raw(key);
    if (value === undefined) return defaultValue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      warnDefault(key, value, 'is not a finite number', defaultValue);
      return defaultValue;
    }
    return parsed;
  };

  const constrained =
    (requirement: string, isValid: (value: number) => boolean) =>
    (key: string, defaultValue: number): number => {
      const value = number(key, defaultValue);
      if (!isValid(value)) {
        warnDefault(key, value, requirement, defaultValue);
        return defaultValue;
      }
      return value;
    };

  return {
    number,
    positiveNumber: constrained('must be positive (> 0)', (v) => v > 0),
    nonNegativeNumber: constrained(
      'must be non-negative (>= 0)',
      (v) => v >= 0
    ),
    positiveInt: constrained(
      'must be a positive integer',
      (v) => Number.isInteger(v) && v > 0
    ),
    probability(key, defaultValue) {
      const value = number(key, defaultValue);
      if (value < 0 || value > 1) {
        logger.warn(
          `${key}=${value} is outside valid probability range (0-1), clamping to bounds`,
          { key, value },
          scope
        );
      }
      return clamp01(value);
    },
    boolean(key, defaultValue) {
      const value = raw(key);
      if (value === undefined) return defaultValue;
      const normalized = value.toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
      }
      warnDefault(key, value, 'is not a valid boolean', defaultValue);
      return defaultValue;
    },
    oneOf(key, allowed, defaultValue) {
      const value = number(key, defaultValue);
      const match = allowed.find((candidate) => candidate === value);
      if (match === undefined) {
        warnDefault(
          key,
          value,
          `must be one of ${allowed.join(', ')}`,
          defaultValue
        );
        return defaultValue;
      }
      return match;
    },
  };
}
