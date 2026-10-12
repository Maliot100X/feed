import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';

const SECRET = 'realtime-unit-secret';
const previous = process.env.REALTIME_SIGNING_SECRET;
process.env.REALTIME_SIGNING_SECRET = SECRET;
const { issueRealtimeToken, verifyRealtimeToken } = await import(
  '../../api/src/realtime/index'
);

const b64 = (value: object | string) =>
  Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value)
  ).toString('base64url');

function sign(header: object | string, payload: object | string): string {
  const input = `${b64(header)}.${b64(payload)}`;
  const sig = createHmac('sha256', SECRET).update(input).digest('base64url');
  return `${input}.${sig}`;
}

const realtimeHeader = { alg: 'HS256', typ: 'JWT', kid: 'realtime' };
const validPayload = () => ({
  userId: 'user-1',
  channels: ['feed'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60,
});

describe('verifyRealtimeToken', () => {
  beforeAll(() => {
    process.env.REALTIME_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.REALTIME_SIGNING_SECRET;
    else process.env.REALTIME_SIGNING_SECRET = previous;
  });

  it('accepts issued tokens', () => {
    const token = issueRealtimeToken({ userId: 'u', channels: ['feed'] });
    expect(verifyRealtimeToken(token)?.userId).toBe('u');
  });

  it('rejects extra segments', () => {
    const token = issueRealtimeToken({ userId: 'u', channels: ['feed'] });
    expect(verifyRealtimeToken(`${token}.extra`)).toBeNull();
  });

  it('rejects other HS256 tokens signed with the same secret', () => {
    expect(
      verifyRealtimeToken(sign({ alg: 'HS256', typ: 'JWT' }, validPayload()))
    ).toBeNull();
  });

  it('returns null (does not throw) for signed malformed JSON', () => {
    expect(verifyRealtimeToken(sign(realtimeHeader, 'not json'))).toBeNull();
  });

  it('rejects payloads with the wrong shape or non-finite expiry', () => {
    expect(
      verifyRealtimeToken(sign(realtimeHeader, { userId: 'u', channels: [] }))
    ).toBeNull();
    expect(
      verifyRealtimeToken(
        sign(realtimeHeader, { ...validPayload(), exp: 'never' })
      )
    ).toBeNull();
  });

  it('rejects expired tokens', () => {
    expect(
      verifyRealtimeToken(sign(realtimeHeader, { ...validPayload(), exp: 1 }))
    ).toBeNull();
  });
});
