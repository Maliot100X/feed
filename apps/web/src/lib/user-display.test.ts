import { describe, expect, it } from 'bun:test';
import { getUserDisplayName, getUserHandle } from './user-display';

describe('getUserDisplayName', () => {
  it('skips blank candidates instead of falling back early', () => {
    expect(getUserDisplayName({ displayName: '  ', username: 'alice' })).toBe(
      'alice'
    );
    expect(getUserDisplayName({ displayName: '', username: null })).toBe(
      'User'
    );
  });

  it('prefers displayName and trims it', () => {
    expect(getUserDisplayName({ displayName: ' Al ', username: 'alice' })).toBe(
      'Al'
    );
  });
});

describe('getUserHandle', () => {
  it('skips blank usernames', () => {
    expect(getUserHandle({ username: ' ', twitterUsername: 'al_x' })).toBe(
      'al_x'
    );
    expect(getUserHandle(null, '-')).toBe('-');
  });
});
