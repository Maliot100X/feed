/**
 * Tests for JSON Continuation Parser
 * Tests various edge cases for merging truncated LLM responses
 */

import { describe, expect, it } from 'bun:test';
import {
  cleanMarkdownCodeBlocks,
  extractJsonFromText,
} from '../json-continuation-parser';

describe('cleanMarkdownCodeBlocks', () => {
  it('should remove markdown code fences', () => {
    const input = '```json\n[{"id": 1}]\n```';
    const result = cleanMarkdownCodeBlocks(input);
    expect(result).toBe('[{"id": 1}]');
  });

  it('should handle code blocks without json tag', () => {
    const input = '```\n[{"id": 1}]\n```';
    const result = cleanMarkdownCodeBlocks(input);
    expect(result).toBe('[{"id": 1}]');
  });

  it('should handle content without code blocks', () => {
    const input = '[{"id": 1}]';
    const result = cleanMarkdownCodeBlocks(input);
    expect(result).toBe('[{"id": 1}]');
  });

  it('should handle multiple code fence markers', () => {
    const input = '```json\n[{"id": 1}]\n```\nSome text\n```\n[{"id": 2}]```';
    const result = cleanMarkdownCodeBlocks(input);
    expect(result).toContain('[{"id": 1}]');
  });
});

describe('extractJsonFromText', () => {
  it('should extract array from prose', () => {
    const input = 'Here are the results: [{"id": 1}, {"id": 2}]';
    const result = extractJsonFromText(input);
    expect(result).toBe('[{"id": 1}, {"id": 2}]');
  });

  it('should extract object from prose', () => {
    const input = 'The result is: {"status": "success"}';
    const result = extractJsonFromText(input);
    expect(result).toBe('{"status": "success"}');
  });

  it('should return as-is if already JSON', () => {
    const input = '[{"id": 1}]';
    const result = extractJsonFromText(input);
    expect(result).toBe(input);
  });
});
