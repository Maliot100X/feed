import { describe, expect, it } from 'bun:test';
import {
  parseErrorText,
  toLocalDateTimeInputValue,
} from '../MarketOversightTab';

describe('parseErrorText', () => {
  it('extracts error from JSON bodies, including leading whitespace', () => {
    expect(parseErrorText('{"error":"Market already resolved"}')).toBe(
      'Market already resolved'
    );
    expect(parseErrorText('  \n{"message":"nope"}')).toBe('nope');
  });

  it('returns malformed JSON and plain text verbatim without throwing', () => {
    expect(parseErrorText('{not json')).toBe('{not json');
    expect(parseErrorText('Bad Gateway')).toBe('Bad Gateway');
    expect(parseErrorText('')).toBe('');
  });
});

describe('toLocalDateTimeInputValue', () => {
  it('round-trips through the browser-local interpretation of datetime-local', () => {
    const date = new Date(2026, 4, 7, 9, 5);
    const value = toLocalDateTimeInputValue(date);
    expect(value).toBe('2026-05-07T09:05');
    expect(new Date(value).toISOString()).toBe(date.toISOString());
  });
});
