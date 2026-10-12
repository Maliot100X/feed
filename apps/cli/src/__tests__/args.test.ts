import { describe, expect, test } from 'bun:test';
import { getFlag, getOption, parseArgs } from '../lib/args';

describe('parseArgs', () => {
  test('parses command, positional args, flags and options', () => {
    const parsed = parseArgs([
      'grant',
      'alice',
      '--verbose',
      '--count=5',
      '--name',
      'bob',
      '-f',
    ]);

    expect(parsed.command).toBe('grant');
    expect(parsed.positional).toEqual(['alice']);
    expect(getFlag(parsed, 'verbose')).toBe(true);
    expect(getFlag(parsed, 'force', 'f')).toBe(true);
    expect(getOption(parsed, 'count')).toBe('5');
    expect(getOption(parsed, 'name')).toBe('bob');
  });

  test('keeps "=" characters inside option values', () => {
    const parsed = parseArgs([
      'seed',
      '--url=postgres://u:p@host/db?sslmode=require',
    ]);

    expect(getOption(parsed, 'url')).toBe(
      'postgres://u:p@host/db?sslmode=require'
    );
  });

  test('treats arguments after -- as positional', () => {
    const parsed = parseArgs(['run', '--dry-run', '--', '--not-a-flag', 'x']);

    expect(parsed.command).toBe('run');
    expect(getFlag(parsed, 'dry-run')).toBe(true);
    expect(parsed.positional).toEqual(['--not-a-flag', 'x']);
    expect(parsed.flags['not-a-flag']).toBeUndefined();
  });
});
