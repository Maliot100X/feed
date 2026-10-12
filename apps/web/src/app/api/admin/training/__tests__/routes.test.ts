import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextResponse } from 'next/server';

const triggerTraining = mock(async () => ({ success: true }));
const benchmarkModel = mock(async () => ({ benchmarkScore: 1 }));
const compareModels = mock(async () => ({ shouldDeploy: true }));

mock.module('@feed/training', () => ({
  automationPipeline: {
    triggerTraining,
    checkTrainingReadiness: async () => ({ ready: true }),
  },
  benchmarkService: {
    benchmarkModel,
    compareModels,
    getBenchmarkSummary: async () => ({}),
  },
}));

mock.module('@feed/api', () => ({
  getClientIp: () => null,
  logAdminModify: async () => undefined,
  logAdminView: async () => undefined,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: (handler: (req: Request) => Promise<Response>) => handler,
}));

const trigger = (await import('../trigger/route')).POST;
const benchmark = (await import('../benchmark/route')).POST;

function post(handler: typeof trigger, body: object) {
  return handler(
    new Request('http://localhost/api/admin/training/x', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

describe('admin training routes', () => {
  beforeEach(() => {
    triggerTraining.mockClear();
    benchmarkModel.mockClear();
    compareModels.mockClear();
  });

  it('trigger rejects string force and unbounded batchSize', async () => {
    expect((await post(trigger, { force: 'false' })).status).toBe(400);
    expect((await post(trigger, { batchSize: 1e9 })).status).toBe(400);
    expect((await post(trigger, { batchSize: 1.5 })).status).toBe(400);
    expect(triggerTraining).not.toHaveBeenCalled();
  });

  it('trigger passes validated options through', async () => {
    const res = await post(trigger, { batchSize: 500 });
    expect(res.status).toBe(200);
    expect(triggerTraining).toHaveBeenCalledWith({
      force: false,
      batchSize: 500,
    });
  });

  it('benchmark rejects object modelId and string compare', async () => {
    expect((await post(benchmark, { modelId: { a: 1 } })).status).toBe(400);
    expect(
      (await post(benchmark, { modelId: 'm1', compare: 'false' })).status
    ).toBe(400);
    expect(
      (await post(benchmark, { modelId: 'm1', threshold: -1 })).status
    ).toBe(400);
    expect(benchmarkModel).not.toHaveBeenCalled();
  });

  it('benchmark skips comparison when compare is false', async () => {
    const res = await post(benchmark, { modelId: 'm1', compare: false });
    expect(res.status).toBe(200);
    expect(compareModels).not.toHaveBeenCalled();
  });
});
