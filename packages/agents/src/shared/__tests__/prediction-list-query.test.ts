import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  parsePredictionListLimit,
  parsePredictionStatus,
  predictionStatusCondition,
} from '../prediction-list-query';

const dialect = new PgDialect();

describe('predictionStatusCondition', () => {
  test('active combines resolved=false AND endDate>=now in one predicate', () => {
    const cond = predictionStatusCondition('active', new Date(0));
    expect(cond).toBeDefined();
    const { sql, params } = dialect.sqlToQuery(cond!);
    expect(sql).toContain('"resolved"');
    expect(sql).toContain('"endDate"');
    expect(sql.toLowerCase()).toContain(' and ');
    expect(params).toContain(false);
  });

  test('resolved filters resolved=true; all has no predicate', () => {
    const { sql } = dialect.sqlToQuery(
      predictionStatusCondition('resolved', new Date())!
    );
    expect(sql).toContain('"resolved"');
    expect(predictionStatusCondition('all', new Date())).toBeUndefined();
  });
});

describe('parsePredictionStatus', () => {
  test('defaults to active and rejects unknown values', () => {
    expect(parsePredictionStatus(undefined)).toBe('active');
    expect(parsePredictionStatus('resolved')).toBe('resolved');
    expect(parsePredictionStatus('closed')).toBeNull();
  });
});

describe('parsePredictionListLimit', () => {
  test('defaults, clamps, and rejects invalid limits', () => {
    expect(parsePredictionListLimit(undefined)).toBe(10);
    expect(parsePredictionListLimit(0)).toBe(1);
    expect(parsePredictionListLimit(500)).toBe(20);
    expect(parsePredictionListLimit(Number.NaN)).toBeNull();
    expect(parsePredictionListLimit(2.5)).toBeNull();
    expect(parsePredictionListLimit('5')).toBe(5);
    expect(parsePredictionListLimit('five')).toBeNull();
  });
});
