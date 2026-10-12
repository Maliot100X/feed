import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const actualDb = await import('@feed/db');

const mockSelect = mock();
const mockUpdate = mock();
const updateCalls: Array<{ set: Record<string, unknown> }> = [];

mock.module('@feed/db', () => ({
  ...actualDb,
  db: { select: mockSelect, update: mockUpdate },
}));

const { GET: exportTrajectories } = await import('../trajectories/route');
const { POST: markTrained } = await import(
  '../trajectories/mark-trained/route'
);
const { GET: identityMap } = await import('../identity-map/route');

const BAD_AUTH = { Authorization: 'Bearer not-the-cron-secret' };

function nextRequest(
  url: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {}
) {
  return new NextRequest(url, init);
}

describe('CRL routes', () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockUpdate.mockReset();
    updateCalls.length = 0;
    mockUpdate.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push({ set: values });
        return {
          where: () => ({
            returning: async () => [{ trajectoryId: 't1' }],
          }),
        };
      },
    }));
  });

  it('rejects trajectory export with invalid credentials and reads nothing', async () => {
    const response = (await exportTrajectories(
      nextRequest('http://localhost/api/crl/trajectories', {
        headers: BAD_AUTH,
      }) as never
    )) as Response;
    expect(response.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects identity map with invalid credentials and reads nothing', async () => {
    const response = (await identityMap(
      nextRequest('http://localhost/api/crl/identity-map', {
        headers: BAD_AUTH,
      }) as never
    )) as Response;
    expect(response.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects mark-trained with invalid credentials and writes nothing', async () => {
    const response = (await markTrained(
      nextRequest('http://localhost/api/crl/trajectories/mark-trained', {
        method: 'POST',
        headers: { ...BAD_AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trajectoryIds: ['t1'] }),
      }) as never
    )) as Response;
    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid export query parameters', async () => {
    for (const query of ['limit=10abc', 'limit=0', 'limit=-1', 'since=nope']) {
      const response = (await exportTrajectories(
        nextRequest(`http://localhost/api/crl/trajectories?${query}`) as never
      )) as Response;
      expect(response.status).toBe(400);
    }
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('rejects malformed mark-trained ids', async () => {
    for (const trajectoryIds of [[], [''], [1, 2], 'abc', null]) {
      const response = (await markTrained(
        nextRequest('http://localhost/api/crl/trajectories/mark-trained', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trajectoryIds }),
        }) as never
      )) as Response;
      expect(response.status).toBe(400);
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reports the number of rows actually marked, deduplicating input', async () => {
    const response = (await markTrained(
      nextRequest('http://localhost/api/crl/trajectories/mark-trained', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trajectoryIds: ['t1', 't1', 'missing'],
          batchId: 'batch-1',
        }),
      }) as never
    )) as Response;
    const body = (await response.json()) as {
      requested: number;
      marked: number;
      batchId: string | null;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ requested: 2, marked: 1, batchId: 'batch-1' });
    expect(updateCalls[0]?.set.trainedInBatch).toBe('batch-1');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
