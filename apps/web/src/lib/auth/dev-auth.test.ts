import { afterEach, describe, expect, it } from 'bun:test';
import {
  getBrowserDevAuthSession,
  PLAYWRIGHT_DEV_AUTH_STORAGE_KEY,
} from './dev-auth';

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('getBrowserDevAuthSession', () => {
  it('returns null instead of throwing when storage access is blocked', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage(): Storage {
          throw new DOMException('blocked', 'SecurityError');
        },
      },
    });
    expect(getBrowserDevAuthSession()).toBeNull();
  });

  it('reads a stored dev session', () => {
    const stored = JSON.stringify({ userId: 'u1', accessToken: 't1' });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) =>
            key === PLAYWRIGHT_DEV_AUTH_STORAGE_KEY ? stored : null,
        },
      },
    });
    expect(getBrowserDevAuthSession()).toMatchObject({
      userId: 'u1',
      accessToken: 't1',
    });
  });
});
