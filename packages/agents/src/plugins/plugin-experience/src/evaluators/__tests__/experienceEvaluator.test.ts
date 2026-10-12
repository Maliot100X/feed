import { describe, expect, test } from 'bun:test';
import {
  parseExtractedExperiences,
  parseMessageCount,
} from '../experienceEvaluator';

describe('parseExtractedExperiences', () => {
  test('keeps only schema-valid experiences', () => {
    const response = `Here you go:
[
  {"type":"DISCOVERY","learning":"jq parses JSON","confidence":0.8},
  {"type":"DISCOVERY","learning":{"nested":true},"confidence":0.8},
  {"type":"DISCOVERY","learning":"x","confidence":"0.9"},
  {"type":"BOGUS","learning":"y","confidence":0.9},
  {"type":"LEARNING","learning":"   ","confidence":0.9},
  {"type":"SUCCESS","learning":"z","confidence":1.5}
]`;
    const result = parseExtractedExperiences(response);
    expect(result).toHaveLength(1);
    expect(result[0]?.learning).toBe('jq parses JSON');
  });

  test('non-JSON or non-array output yields nothing', () => {
    expect(parseExtractedExperiences('no json')).toEqual([]);
    expect(parseExtractedExperiences('[not json]')).toEqual([]);
    expect(parseExtractedExperiences('{"a":1}')).toEqual([]);
  });
});

describe('parseMessageCount', () => {
  test('corrupt counters restart at zero instead of NaN', () => {
    expect(parseMessageCount('7')).toBe(7);
    expect(parseMessageCount(undefined)).toBe(0);
    expect(parseMessageCount('abc')).toBe(0);
    expect(parseMessageCount('-2')).toBe(0);
  });
});
