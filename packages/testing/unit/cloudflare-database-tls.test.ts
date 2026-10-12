import { expect, test } from 'bun:test';
import { postgresTlsMode } from '../../db/src/tls';

test('remote production and Workers databases require certificate verification', () => {
  for (const query of [
    '',
    '?sslmode=require',
    '?sslmode=disable',
    '?ssl=false',
  ]) {
    const url = `postgres://user:password@db.feed.fun/feed${query}`;
    expect(postgresTlsMode(url, true, false)).toBe('verify-full');
    expect(postgresTlsMode(url, false, true)).toBe('verify-full');
  }
  expect(
    postgresTlsMode(
      'postgres://localhost:password@db.feed.fun/feed',
      true,
      false
    )
  ).toBe('verify-full');
});

test('local development stays usable and explicit TLS is verified', () => {
  expect(postgresTlsMode('postgres://localhost/feed', false, false)).toBe(
    false
  );
  expect(postgresTlsMode('postgres://127.0.0.1/feed', true, true)).toBe(false);
  expect(
    postgresTlsMode('postgres://localhost/feed?sslmode=require', false, false)
  ).toBe('verify-full');
  expect(
    postgresTlsMode('postgres://db.example.supabase.co/feed', false, false)
  ).toBe('verify-full');
});

test('Hyperdrive local endpoints skip TLS because Hyperdrive verifies the origin', () => {
  expect(
    postgresTlsMode(
      'postgres://user:password@abc123.hyperdrive.local:5432/feed',
      true,
      true,
      undefined
    )
  ).toBe(false);
});

test('a pinned CA verifies the chain without requiring the proxy hostname', () => {
  const tls = postgresTlsMode(
    'postgres://user:password@sakura.proxy.rlwy.net:11256/feed',
    true,
    false,
    '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
  );
  if (typeof tls !== 'object') throw new Error('Expected pinned CA options');
  expect(tls.rejectUnauthorized).toBe(true);
  expect(tls.ca).toContain('BEGIN CERTIFICATE');
  expect(tls.checkServerIdentity?.('sakura.proxy.rlwy.net', {} as never)).toBe(
    undefined
  );
  expect(
    postgresTlsMode('postgres://localhost/feed', false, false, 'pem')
  ).toBe(false);
});
