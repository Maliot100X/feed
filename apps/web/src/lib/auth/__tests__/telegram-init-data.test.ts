import { describe, expect, it } from 'bun:test';
import { verifyTelegramInitData } from '../telegram-init-data';
import {
  signInitData,
  TEST_BOT_TOKEN,
  userJson,
} from './telegram-init-fixture';

const NOW_MS = 1_750_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);
const OPTIONS = { maxAgeSeconds: 300, nowMs: NOW_MS };

function verify(initData: string, options = OPTIONS) {
  return verifyTelegramInitData(initData, TEST_BOT_TOKEN, options);
}

describe('verifyTelegramInitData', () => {
  it('accepts correctly signed, fresh launch data', () => {
    const initData = signInitData([
      ['auth_date', String(NOW_S - 10)],
      ['query_id', 'AAH'],
      ['user', userJson()],
    ]);
    const result = verify(initData);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.user.id).toBe(12345678);
      expect(result.data.authDate).toBe(NOW_S - 10);
      expect(result.data.queryId).toBe('AAH');
    }
  });

  it('is independent of parameter order in the query string', () => {
    const params: Array<[string, string]> = [
      ['user', userJson()],
      ['auth_date', String(NOW_S)],
    ];
    expect(verify(signInitData(params)).valid).toBe(true);
    expect(verify(signInitData([...params].reverse())).valid).toBe(true);
  });

  it('rejects data signed with a different bot token', () => {
    const initData = signInitData(
      [
        ['auth_date', String(NOW_S)],
        ['user', userJson()],
      ],
      '999:other-token'
    );
    expect(verify(initData)).toEqual({
      valid: false,
      reason: 'hash verification failed',
    });
  });

  it('rejects tampered user data', () => {
    const initData = signInitData([
      ['auth_date', String(NOW_S)],
      ['user', userJson()],
    ]).replace(encodeURIComponent('12345678'), encodeURIComponent('99999999'));
    expect(verify(initData).valid).toBe(false);
  });

  it('rejects stale auth_date', () => {
    const initData = signInitData([
      ['auth_date', String(NOW_S - 301)],
      ['user', userJson()],
    ]);
    expect(verify(initData)).toEqual({
      valid: false,
      reason: 'auth_date expired',
    });
  });

  it('accepts auth_date exactly at the max age boundary', () => {
    const initData = signInitData([
      ['auth_date', String(NOW_S - 300)],
      ['user', userJson()],
    ]);
    expect(verify(initData).valid).toBe(true);
  });

  it('rejects auth_date too far in the future', () => {
    const initData = signInitData([
      ['auth_date', String(NOW_S + 120)],
      ['user', userJson()],
    ]);
    expect(verify(initData)).toEqual({
      valid: false,
      reason: 'auth_date in the future',
    });
  });

  it('rejects non-integer auth_date even when signed', () => {
    const initData = signInitData([
      ['auth_date', `${NOW_S}abc`],
      ['user', userJson()],
    ]);
    expect(verify(initData)).toEqual({
      valid: false,
      reason: 'missing or invalid auth_date',
    });
  });

  it('rejects duplicate keys', () => {
    const initData = `${signInitData([
      ['auth_date', String(NOW_S)],
      ['user', userJson()],
    ])}&user=${encodeURIComponent(userJson({ id: 1 }))}`;
    expect(verify(initData)).toEqual({
      valid: false,
      reason: 'duplicate parameter',
    });
  });

  it('rejects malformed hash grammar', () => {
    expect(verify(`auth_date=${NOW_S}&hash=abc`)).toEqual({
      valid: false,
      reason: 'missing or malformed hash',
    });
    expect(verify(`auth_date=${NOW_S}`).valid).toBe(false);
  });

  it('rejects signed but malformed user payloads', () => {
    for (const user of [
      'null',
      '{not json',
      JSON.stringify({ first_name: 'NoId' }),
      JSON.stringify({ id: -5, first_name: 'Neg' }),
      JSON.stringify({ id: 1.5, first_name: 'Frac' }),
      JSON.stringify({ id: '123', first_name: 'Str' }),
    ]) {
      const initData = signInitData([
        ['auth_date', String(NOW_S)],
        ['user', user],
      ]);
      expect(verify(initData).valid).toBe(false);
    }
  });

  it('rejects missing user', () => {
    const initData = signInitData([['auth_date', String(NOW_S)]]);
    expect(verify(initData)).toEqual({
      valid: false,
      reason: 'missing user data',
    });
  });

  it('accepts unicode user names', () => {
    const initData = signInitData([
      ['auth_date', String(NOW_S)],
      ['user', userJson({ first_name: 'Мария 🚀', username: 'maria' })],
    ]);
    const result = verify(initData);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.data.user.first_name).toBe('Мария 🚀');
  });
});
