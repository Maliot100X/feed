import { describe, expect, test } from 'bun:test';
import { evaluateAlertCooldown } from '../PriceAlertService';

const NOW = Date.parse('2026-01-01T12:00:00.000Z');

describe('evaluateAlertCooldown', () => {
  test('never-triggered alert is ready', () => {
    expect(
      evaluateAlertCooldown({ threshold: 10, cooldownMinutes: 15 }, NOW).status
    ).toBe('ready');
  });

  test('respects cooldown window', () => {
    const lastTriggeredAt = new Date(NOW - 5 * 60_000).toISOString();
    expect(
      evaluateAlertCooldown(
        { threshold: 10, cooldownMinutes: 15, lastTriggeredAt },
        NOW
      ).status
    ).toBe('cooling-down');
    expect(
      evaluateAlertCooldown(
        { threshold: 10, cooldownMinutes: 1, lastTriggeredAt },
        NOW
      ).status
    ).toBe('ready');
  });

  test('explicit zero cooldown is honored instead of defaulting to 15', () => {
    const lastTriggeredAt = new Date(NOW - 1_000).toISOString();
    expect(
      evaluateAlertCooldown(
        { threshold: 10, cooldownMinutes: 0, lastTriggeredAt },
        NOW
      ).status
    ).toBe('ready');
  });

  test('invalid timestamp does not silently disable the cooldown', () => {
    expect(
      evaluateAlertCooldown(
        { threshold: 10, cooldownMinutes: 15, lastTriggeredAt: 'garbage' },
        NOW
      ).status
    ).toBe('invalid');
  });

  test('non-positive or non-finite thresholds are invalid', () => {
    for (const threshold of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        evaluateAlertCooldown({ threshold, cooldownMinutes: 15 }, NOW).status
      ).toBe('invalid');
    }
  });

  test('negative cooldown is invalid', () => {
    expect(
      evaluateAlertCooldown({ threshold: 10, cooldownMinutes: -1 }, NOW).status
    ).toBe('invalid');
  });
});
