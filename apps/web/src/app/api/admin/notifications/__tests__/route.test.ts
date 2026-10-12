import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualApi from '@feed/api';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

let recipients: { id: string }[] = [];
const createNotification = mock(async (params: { userId: string }) => {
  if (params.userId === 'boom') throw new Error('db down');
  return { created: params.userId !== 'dupe' };
});
const findMany = mock(async () => recipients);

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    user: {
      findMany,
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        username: where.id,
        displayName: where.id,
        isActor: where.id === 'npc',
      }),
    },
  },
}));

mock.module('@feed/api', () => ({
  createNotification,
  NotFoundError: actualApi.NotFoundError,
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { POST } = await import('../route');

function post(body: object) {
  return POST(
    new Request('http://localhost/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

describe('POST /api/admin/notifications', () => {
  beforeEach(() => {
    recipients = [];
    createNotification.mockClear();
    findMany.mockClear();
  });

  it('rejects userId combined with sendToAll instead of broadcasting', async () => {
    const res = await post({ message: 'hi', userId: 'u1', sendToAll: true });
    expect(res.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('rejects requests with neither target', async () => {
    const res = await post({ message: 'hi' });
    expect(res.status).toBe(400);
  });

  it('reports actual broadcast outcomes', async () => {
    recipients = [{ id: 'u1' }, { id: 'boom' }, { id: 'dupe' }];
    const res = await post({ message: 'hi', sendToAll: true });
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      recipientCount: 3,
      sentCount: 1,
      skippedCount: 1,
      failedCount: 1,
    });
  });

  it('returns 400 for actor targets', async () => {
    const res = await post({ message: 'hi', userId: 'npc' });
    expect(res.status).toBe(400);
    expect(createNotification).not.toHaveBeenCalled();
  });
});
