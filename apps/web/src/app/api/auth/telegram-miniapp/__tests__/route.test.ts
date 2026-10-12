import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  signInitData,
  TEST_BOT_TOKEN,
  userJson,
} from '@/lib/auth/__tests__/telegram-init-fixture';

const mockSelect = mock();
const mockEnsureStewardUser = mock();

mock.module('@feed/db', () => ({
  db: {
    select: mockSelect,
    update: mock(),
    insert: mock(),
  },
  eq: () => ({}),
  users: { id: 'id', stewardId: 'stewardId', email: 'email', telegramId: 't' },
}));

mock.module('@/lib/auth/steward-server', () => ({
  ensureStewardUser: mockEnsureStewardUser,
  getStewardJwtSecret: () => new TextEncoder().encode('test-secret'),
}));

const { POST } = await import('../route');

const originalToken = process.env.TELEGRAM_BOT_TOKEN;

function request(body: unknown): Request {
  return new Request('http://localhost/api/auth/telegram-miniapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/telegram-miniapp', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
    mockSelect.mockReset();
    mockEnsureStewardUser.mockReset();
  });

  afterAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
  });

  it('rejects stale signed launch data without touching identity', async () => {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const initData = signInitData([
      ['auth_date', String(twoHoursAgo)],
      ['user', userJson()],
    ]);

    const response = (await POST(request({ initData }) as never)) as Response;
    const body = (await response.json()) as { ok: boolean; token?: string };

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.token).toBeUndefined();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockEnsureStewardUser).not.toHaveBeenCalled();
  });

  it('rejects future-dated signed launch data', async () => {
    const inOneHour = Math.floor(Date.now() / 1000) + 60 * 60;
    const initData = signInitData([
      ['auth_date', String(inOneHour)],
      ['user', userJson()],
    ]);

    const response = (await POST(request({ initData }) as never)) as Response;
    expect(response.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects signed launch data with a malformed user', async () => {
    const initData = signInitData([
      ['auth_date', String(Math.floor(Date.now() / 1000))],
      ['user', 'null'],
    ]);

    const response = (await POST(request({ initData }) as never)) as Response;
    expect(response.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects data signed for a different bot', async () => {
    const initData = signInitData(
      [
        ['auth_date', String(Math.floor(Date.now() / 1000))],
        ['user', userJson()],
      ],
      '42:other-bot'
    );

    const response = (await POST(request({ initData }) as never)) as Response;
    expect(response.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects a null body', async () => {
    const response = (await POST(request(null) as never)) as Response;
    expect(response.status).toBe(400);
  });

  it('mints a token for fresh, valid launch data of an existing user', async () => {
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [
            { id: 'user-1', stewardId: 'steward-1', email: null },
          ],
        }),
      }),
    });
    const initData = signInitData([
      ['auth_date', String(Math.floor(Date.now() / 1000) - 5)],
      ['user', userJson()],
    ]);

    const { db } = await import('@feed/db');
    (db.update as ReturnType<typeof mock>).mockReturnValue({
      set: () => ({ where: async () => undefined }),
    });

    const response = (await POST(request({ initData }) as never)) as Response;
    const body = (await response.json()) as { ok: boolean; token?: string };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
