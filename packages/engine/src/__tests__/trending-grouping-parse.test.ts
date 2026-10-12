import { describe, expect, it } from 'bun:test';
import { parseGroupingResponse } from '../services/trending-grouping-service';

const group = (id: number, tags: string[], summary?: string) =>
  `<group><id>${id}</id><tags>${tags.map((t) => `<tag>${t}</tag>`).join('')}</tags>${
    summary ? `<summary>${summary}</summary>` : ''
  }</group>`;

describe('parseGroupingResponse', () => {
  const known = ['OpenAGI', 'Sam AIltman', 'TeslAI', 'AIlon Musk'];

  it('keeps groups with repeated model IDs distinct', () => {
    const xml = `<response><groups>${group(1, ['OpenAGI', 'Sam AIltman'], 'A')}${group(1, ['TeslAI', 'AIlon Musk'], 'B')}</groups></response>`;
    const { tagToGroup, groupSummaries } = parseGroupingResponse(xml, known);

    expect(tagToGroup.get('OpenAGI')).toBe(tagToGroup.get('Sam AIltman'));
    expect(tagToGroup.get('TeslAI')).toBe(tagToGroup.get('AIlon Musk'));
    expect(tagToGroup.get('OpenAGI')).not.toBe(tagToGroup.get('TeslAI'));
    expect([...groupSummaries.values()].sort()).toEqual(['A', 'B']);
  });

  it('ignores unknown and duplicate tags and drops groups under two members', () => {
    const xml = group(1, ['OpenAGI', 'Invented Tag', 'OpenAGI'], 'X');
    const { tagToGroup, groupSummaries } = parseGroupingResponse(xml, known);

    expect(tagToGroup.size).toBe(0);
    expect(groupSummaries.size).toBe(0);
  });

  it('assigns each tag to at most one group', () => {
    const xml =
      group(1, ['OpenAGI', 'Sam AIltman']) + group(2, ['OpenAGI', 'TeslAI']);
    const { tagToGroup } = parseGroupingResponse(xml, known);

    // Second group only has one unassigned known tag, so it is dropped
    expect(tagToGroup.has('TeslAI')).toBe(false);
    expect(tagToGroup.size).toBe(2);
  });
});
