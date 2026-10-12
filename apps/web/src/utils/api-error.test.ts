import { describe, expect, it } from 'bun:test';
import { readApiErrorMessage } from './api-error';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 400 });

describe('readApiErrorMessage', () => {
  it('reads string and nested error shapes', async () => {
    expect(await readApiErrorMessage(json({ error: 'nope' }), 'x')).toBe(
      'nope'
    );
    expect(
      await readApiErrorMessage(json({ error: { message: 'bad' } }), 'x')
    ).toBe('bad');
    expect(await readApiErrorMessage(json({ message: 'legacy' }), 'x')).toBe(
      'legacy'
    );
  });

  it('falls back for non-JSON bodies', async () => {
    expect(
      await readApiErrorMessage(new Response('oops', { status: 500 }), 'x')
    ).toBe('x');
  });
});
