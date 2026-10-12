import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

type Bias = {
  entityId: string;
  entityName: string;
  direction: 'up' | 'down';
  strength: number;
  createdAt: Date;
  expiresAt: Date | null;
  decayRate: number;
};

const mockTune = mock();
const mockSetBias = mock();
const mockSetBulk = mock();
let activeBiases: Bias[] = [];

mock.module('@feed/api', () => ({
  requireAdmin: async () => ({ userId: 'admin-1' }),
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/engine', () => ({
  biasEngine: {
    tuneBiasStrength: mockTune,
    setBias: mockSetBias,
    setBulkBiases: mockSetBulk,
    removeBias: mock(),
    getBiasAdjustment: () => ({ priceImpact: 0, sentimentShift: 0 }),
    getActiveBiases: () => activeBiases,
  },
}));

mock.module('@feed/shared', () => ({
  logger: { info: mock(), warn: mock(), error: mock() },
  toISO: (value: Date) => value.toISOString(),
}));

const { POST: tune } = await import('../tune/route');
const { POST: configure } = await import('../configure/route');
const { GET: active } = await import('../active/route');

function post(body: unknown): NextRequest {
  return new Request('http://localhost/api/markets/bias', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const baseBias = {
  entityId: 'org-1',
  entityName: 'Org One',
  direction: 'up',
};

describe('market bias admin routes', () => {
  beforeEach(() => {
    mockTune.mockReset();
    mockSetBias.mockReset();
    mockSetBulk.mockReset();
    activeBiases = [];
  });

  it('tune returns 404 when no bias exists for the entity', async () => {
    mockTune.mockReturnValue(false);

    const response = (await tune(
      post({ entityId: 'missing', strength: 0.4 })
    )) as Response;

    expect(response.status).toBe(404);
  });

  it('tune reports success when the bias was updated', async () => {
    mockTune.mockReturnValue(true);

    const response = (await tune(
      post({ entityId: 'org-1', strength: 0.4 })
    )) as Response;

    expect(response.status).toBe(200);
  });

  it('rejects zero and negative durations instead of making them permanent/expired', async () => {
    await expect(
      configure(post({ action: 'set', ...baseBias, durationHours: 0 }))
    ).rejects.toThrow();
    await expect(
      configure(post({ action: 'set', ...baseBias, durationHours: -1 }))
    ).rejects.toThrow();
    expect(mockSetBias).not.toHaveBeenCalled();
  });

  it('rejects duplicate entity ids in bulk-set', async () => {
    await expect(
      configure(post({ action: 'bulk-set', biases: [baseBias, baseBias] }))
    ).rejects.toThrow();
    expect(mockSetBulk).not.toHaveBeenCalled();
  });

  it('does not list expired biases as active', async () => {
    const now = Date.now();
    activeBiases = [
      {
        ...baseBias,
        direction: 'up',
        strength: 0.5,
        createdAt: new Date(now - 10_000),
        expiresAt: new Date(now - 1_000),
        decayRate: 0.1,
      },
      {
        ...baseBias,
        entityId: 'org-2',
        direction: 'down',
        strength: 0.5,
        createdAt: new Date(now - 10_000),
        expiresAt: null,
        decayRate: 0.1,
      },
    ];

    const response = (await active()) as Response;
    const body = (await response.json()) as {
      biases: Array<{ entityId: string }>;
    };

    expect(body.biases.map((b) => b.entityId)).toEqual(['org-2']);
  });
});
