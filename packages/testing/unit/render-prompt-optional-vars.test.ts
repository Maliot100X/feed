import { describe, expect, it } from 'bun:test';
import { renderPrompt } from '@feed/engine';

const testPrompt = {
  id: 'test-prompt',
  version: '1.0.0',
  category: 'test',
  description: 'Test prompt',
  template: `Hello {{name}}!
Required: {{requiredVar}}
Optional1: {{previousTrades}}
Optional2: {{characterRoster}}
Optional3: {{resolvedQuestionsContext}}
End.`,
};

describe('renderPrompt optional variable cleanup', () => {
  it('should replace supplied variables normally', () => {
    const result = renderPrompt(testPrompt, {
      name: 'Alice',
      requiredVar: 'present',
      previousTrades: 'some trades',
    });

    expect(result).toContain('Hello Alice!');
    expect(result).toContain('Required: present');
    expect(result).toContain('Optional1: some trades');
  });

  it('should strip unpopulated optional vars instead of leaving literal {{varName}}', () => {
    const result = renderPrompt(testPrompt, {
      name: 'Alice',
      requiredVar: 'present',
    });

    expect(result).not.toContain('{{previousTrades}}');
    expect(result).not.toContain('{{characterRoster}}');
    expect(result).not.toContain('{{resolvedQuestionsContext}}');
    expect(result).toContain('Optional1: ');
    expect(result).toContain('Optional2: ');
    expect(result).toContain('Optional3: ');
  });

  it('should not contain any double-brace placeholders after rendering', () => {
    const result = renderPrompt(testPrompt, {
      name: 'Bob',
      requiredVar: 'here',
    });

    expect(result).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });

  it('should keep supplied optional vars and strip only unsupplied ones', () => {
    const result = renderPrompt(testPrompt, {
      name: 'Charlie',
      requiredVar: 'yes',
      previousTrades: 'BTC long $500',
    });

    expect(result).toContain('Optional1: BTC long $500');
    expect(result).not.toContain('{{characterRoster}}');
    expect(result).not.toContain('{{resolvedQuestionsContext}}');
  });
});

describe('required prompt context integrity', () => {
  it('rejects omitted, null, empty and non-finite required values', () => {
    for (const variables of [
      {},
      { name: null },
      { name: ' ' },
      { name: Number.NaN },
    ]) {
      expect(() =>
        renderPrompt({ ...testPrompt, template: '{{name}}' }, variables)
      ).toThrow();
    }
    expect(() =>
      renderPrompt(
        { ...testPrompt, template: '{{missing}}' },
        {},
        { allowEmpty: true }
      )
    ).toThrow('missing');
  });

  it('requires explicit core trading and conversation context even when empty is valid', () => {
    for (const key of [
      'marketTable',
      'npcsList',
      'validNpcIds',
      'validTickers',
      'currentPositions',
      'conversationHistory',
      'groupMembers',
      'marketConditions',
    ]) {
      const prompt = { ...testPrompt, template: `{{${key}}}` };
      expect(() => renderPrompt(prompt, {})).toThrow(key);
      expect(() => renderPrompt(prompt, { [key]: null })).toThrow(key);
      expect(renderPrompt(prompt, { [key]: '' })).toBe('');
    }
  });

  it('preserves dollar sequences and template syntax in supplied content', () => {
    const text = "$& $` $' $$ {{requiredVar}}";
    expect(
      renderPrompt(
        { ...testPrompt, template: '{{name}} / {{requiredVar}}' },
        { name: text, requiredVar: 'value' }
      )
    ).toBe(`${text} / value`);
  });

  it('preserves zero and false and ignores unrelated unused data', () => {
    expect(
      renderPrompt(
        { ...testPrompt, template: '{{zero}} {{flag}}' },
        { zero: 0, flag: false, unused: null }
      )
    ).toBe('0 false');
  });
});
