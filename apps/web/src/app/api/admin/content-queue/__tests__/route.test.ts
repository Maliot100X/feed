import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';
import { NextResponse } from 'next/server';

let results: object[][] = [];

function chain() {
  const rows = () => Promise.resolve(results.shift() ?? []);
  const c = {
    from: () => c,
    innerJoin: () => c,
    where: () => c,
    groupBy: () => c,
    orderBy: () => c,
    limit: () => c,
    offset: rows,
    then: (resolve: (r: object[]) => void) => rows().then(resolve),
  };
  return c;
}

mock.module('@feed/db', () => ({
  ...actualDb,
  db: { select: chain },
}));

mock.module('@feed/api', () => ({
  requireAdmin: async () => ({ userId: 'admin-1' }),
  errorResponse: (message: string, code: string, status: number) =>
    NextResponse.json({ error: { message, code } }, { status }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const { GET } = await import('../route');

const post = (id: string, imageUrl: string | null) => ({
  id,
  content: 'x',
  createdAt: new Date(),
  deletedAt: null,
  authorId: 'a',
  imageUrl,
  reportCount: 1,
});

function get(query = 'type=posts') {
  return GET(
    new Request(`http://localhost/api/admin/content-queue?${query}`) as never
  ) as Promise<Response>;
}

describe('GET /api/admin/content-queue', () => {
  beforeEach(() => {
    results = [];
  });

  it('keeps serving the queue when an image URL is malformed', async () => {
    results = [
      [
        post('p1', 'not a url'),
        post('p2', '/uploads/abc.png'),
        post('p3', 'https://images.unsplash.com/a.png'),
        post('p4', 'https://evil.example/a.png'),
      ],
      [{ pending: 4, deleted: 0 }],
      [{ pending: 0, deleted: 0 }],
    ];
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts.map((p: { mediaUrls: string[] }) => p.mediaUrls)).toEqual(
      [[], ['/uploads/abc.png'], ['https://images.unsplash.com/a.png'], []]
    );
  });

  it('returns an error envelope for invalid query parameters', async () => {
    const res = await get('limit=1.5');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
