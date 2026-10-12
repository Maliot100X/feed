import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

const created: object[] = [];
const setManualTopic = mock(async () => ({ id: 't1' }));
const deleteFact = mock(async () => undefined);

mock.module('@feed/db', () => ({
  ...actualDb,
  db: {
    worldFact: {
      findFirst: async () => null,
      update: async () => ({ id: 'f1' }),
      create: async (args: { data: object }) => {
        created.push(args.data);
        return { id: 'f1' };
      },
    },
  },
}));

mock.module('@feed/engine', () => ({
  characterMappingService: {},
  createParodyHeadlineGenerator: () => ({}),
  dailyTopicService: { setManualTopic },
  rssFeedService: {},
  worldFactsGenerator: {},
  worldFactsService: { deleteFact, updateFactById: async () => ({}) },
}));

mock.module('@feed/api', () => ({
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const route = await import('../route');

function post(body: object) {
  return route.POST(
    new Request('http://localhost/api/admin/world-facts', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

describe('POST /api/admin/world-facts', () => {
  beforeEach(() => {
    created.length = 0;
    setManualTopic.mockClear();
    deleteFact.mockClear();
  });

  it('returns 400 (not a crash) for missing data', async () => {
    expect((await post({ action: 'delete_fact' })).status).toBe(400);
    expect((await post({ action: 'update_fact' })).status).toBe(400);
    expect(deleteFact).not.toHaveBeenCalled();
  });

  it('rejects unknown actions and object topic labels', async () => {
    expect((await post({ action: 'nope' })).status).toBe(400);
    expect(
      (
        await post({
          action: 'set_daily_topic_override',
          data: { topicLabel: { toString: 'x' } },
        })
      ).status
    ).toBe(400);
    expect(setManualTopic).not.toHaveBeenCalled();
  });

  it('rejects invalid dates', async () => {
    const res = await post({
      action: 'set_daily_topic_override',
      data: { topicLabel: 'AI', date: 'not-a-date' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects facts whose derived key would be empty', async () => {
    const res = await post({
      action: 'add_fact',
      data: { value: '日本: 東京' },
    });
    expect(res.status).toBe(400);
    expect(created).toHaveLength(0);
  });

  it('adds a fact with a derived key', async () => {
    const res = await post({
      action: 'add_fact',
      data: { value: 'Fed Rate: 4.5%' },
    });
    expect(res.status).toBe(200);
    expect(created[0]).toMatchObject({ key: 'fed_rate', category: 'general' });
  });

  it('no longer exposes the duplicate DELETE handler', () => {
    expect('DELETE' in route).toBe(false);
  });
});
