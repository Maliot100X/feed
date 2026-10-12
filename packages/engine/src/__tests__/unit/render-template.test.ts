import { describe, expect, test } from 'bun:test';
import { renderTemplate } from '../../prompts/define-prompt';

describe('renderTemplate', () => {
  test('inserts dollar sequences literally', () => {
    expect(
      renderTemplate('Price: {{price}}', { price: "$& $` $' $1 $$" })
    ).toBe("Price: $& $` $' $1 $$");
  });

  test('does not re-expand placeholders inside inserted values', () => {
    expect(renderTemplate('{{a}} / {{b}}', { a: '{{b}}', b: 'B' })).toBe(
      '{{b}} / B'
    );
    expect(renderTemplate('{{b}} / {{a}}', { a: '{{b}}', b: 'B' })).toBe(
      'B / {{b}}'
    );
  });

  test('renders falsy values faithfully and null/undefined as empty', () => {
    expect(
      renderTemplate('{{f}}|{{z}}|{{n}}|{{u}}|{{e}}', {
        f: false,
        z: 0,
        n: null,
        u: undefined,
        e: '',
      })
    ).toBe('false|0|||');
  });

  test('leaves unknown placeholders unchanged', () => {
    expect(renderTemplate('Hi {{name}} {{missing}}', { name: 'A' })).toBe(
      'Hi A {{missing}}'
    );
  });

  test('keys containing regex metacharacters are matched literally', () => {
    expect(renderTemplate('{{a.b}} {{axb}}', { 'a.b': 'dot' })).toBe(
      'dot {{axb}}'
    );
  });
});
