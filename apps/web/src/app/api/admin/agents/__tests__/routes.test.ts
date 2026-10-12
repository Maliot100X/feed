import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as actualDb from '@feed/db';

let updateRows: { userId: string }[] = [];
let selectRows: { userId: string }[] = [];
const setCalls: Record<string, boolean | string | Date>[] = [];
const audit = mock(async () => undefined);

function updateChain() {
  const c = {
    set: (values: Record<string, boolean | string | Date>) => {
      setCalls.push(values);
      return c;
    },
    where: () => c,
    returning: async () => updateRows,
  };
  return c;
}

function selectChain() {
  const c = {
    from: () => c,
    innerJoin: () => c,
    where: async () => selectRows,
  };
  return c;
}

mock.module('@feed/db', () => ({
  ...actualDb,
  db: { update: updateChain, select: selectChain },
}));

mock.module('@feed/api', () => ({
  getClientIp: () => null,
  logAdminModify: audit,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  withErrorHandling: (handler: () => Promise<Response>) => handler,
}));

const toggle = (await import('../[agentId]/toggle/route')).POST;
const pauseAll = (await import('../pause-all/route')).POST;
const resumeAll = (await import('../resume-all/route')).POST;

function callToggle(body: object) {
  return toggle(
    new Request('http://localhost/api/admin/agents/a1/toggle', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ agentId: 'a1' }) }
  ) as Promise<Response>;
}

const req = () =>
  new Request('http://localhost/api/admin/agents', {
    method: 'POST',
  }) as never;

describe('admin agent controls', () => {
  beforeEach(() => {
    updateRows = [];
    selectRows = [];
    setCalls.length = 0;
    audit.mockClear();
  });

  it('rejects non-boolean enabled (string "false" was truthy)', async () => {
    const res = await callToggle({ enabled: 'false' });
    expect(res.status).toBe(400);
    expect(setCalls).toHaveLength(0);
  });

  it('returns 404 when no agent config was updated', async () => {
    const res = await callToggle({ enabled: false });
    expect(res.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it('pauses an existing agent and reports the committed status', async () => {
    updateRows = [{ userId: 'a1' }];
    const res = await callToggle({ enabled: false });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      agentId: 'a1',
      enabled: false,
      status: 'paused',
    });
    expect(setCalls[0]?.autonomousTrading).toBe(false);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('pause-all marks agents paused and returns the affected count', async () => {
    updateRows = [{ userId: 'a1' }, { userId: 'a2' }];
    const res = (await pauseAll(req())) as Response;
    expect((await res.json()).data).toEqual({ paused: 2 });
    expect(setCalls[0]?.status).toBe('paused');
  });

  it('resume-all reports the actually resumed count', async () => {
    selectRows = [{ userId: 'a1' }, { userId: 'a2' }];
    updateRows = [{ userId: 'a1' }];
    const res = (await resumeAll(req())) as Response;
    expect((await res.json()).data).toEqual({ resumed: 1 });
  });
});
