import { expect, test } from 'bun:test';
import { formatAgentActionResults } from '../../agents/src/services/agent-action-context';

test('next-step context preserves numeric outputs and late qualifiers', () => {
  const qualifier = `${'position detail '.repeat(500)}do not sell before resolution`;
  const context = formatAgentActionResults([
    {
      actionType: 'CHECK_PNL',
      success: true,
      text: qualifier,
      values: { balance: 1234.56, positionId: '9007199254740993123' },
    },
  ]);
  expect(context).toContain('do not sell before resolution');
  expect(context).toContain('1234.56');
  expect(context).toContain('9007199254740993123');
});

test('action Error objects retain their messages in follow-up prompts', () => {
  expect(
    formatAgentActionResults([
      {
        actionType: 'TRADE',
        success: false,
        error: new Error('required market missing'),
      },
    ])
  ).toContain('Error: required market missing');
});
