import { createHmac } from 'node:crypto';

export const TEST_BOT_TOKEN = '123456789:ABCDefGHIJKLmnoPQRSTuvWXyz';

/**
 * Independent signer for Telegram initData fixtures. Mirrors the documented
 * Telegram algorithm (not the production verifier) so tests can produce
 * correctly and incorrectly signed launch data.
 */
export function signInitData(
  params: Array<[string, string]>,
  botToken: string = TEST_BOT_TOKEN
): string {
  const dataCheckString = [...params]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  const search = new URLSearchParams(params);
  search.append('hash', hash);
  return search.toString();
}

export function userJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 12345678,
    first_name: 'John',
    username: 'johndoe',
    ...overrides,
  });
}
