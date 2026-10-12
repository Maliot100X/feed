import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';
import { ClosePerpPositionSchema } from '../../../../../../../../../../../packages/shared/src/validation/schemas/market';

class TestBadRequestError extends Error {
  readonly statusCode = 400;
}

const mockClosePosition = mock();
const mockCreateService = mock(() => ({ closePosition: mockClosePosition }));

mock.module('@feed/api', () => ({
  authenticate: async () => ({ userId: 'user-1' }),
  BadRequestError: TestBadRequestError,
  checkRateLimitAsync: async () => ({ allowed: true }),
  invalidateMarketsApiPerpsSnapshot: async () => undefined,
  RATE_LIMIT_CONFIGS: { CLOSE_POSITION: {} },
  rateLimitError: () => new Response(null, { status: 429 }),
  successResponse: (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status }),
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/engine', () => ({
  handlePlayerTrade: async () => undefined,
}));

mock.module('@feed/shared', () => ({
  ClosePerpPositionSchema,
  fireAndForgetWithRetry: () => undefined,
  logger: { info: mock(), warn: mock(), error: mock() },
}));

mock.module('@/lib/posthog/server', () => ({
  trackServerEvent: async () => undefined,
}));

mock.module('../../../../_adapters', () => ({
  createPerpMarketService: mockCreateService,
}));

const { POST } = await import('../route');

const context = { params: Promise.resolve({ id: 'pos-1' }) };

function closeRequest(body?: string): NextRequest {
  return new Request(
    'http://localhost/api/markets/perps/position/pos-1/close',
    {
      method: 'POST',
      body,
    }
  ) as unknown as NextRequest;
}

describe('POST /api/markets/perps/position/[id]/close', () => {
  beforeEach(() => {
    mockClosePosition.mockReset();
    mockClosePosition.mockResolvedValue({
      ticker: 'ABC',
      side: 'long',
      size: 10,
      leverage: 2,
      feePaid: 0.1,
      balance: 100,
    });
  });

  it('treats an absent body as a full market close', async () => {
    const response = (await POST(closeRequest(), context)) as Response;

    expect(response.status).toBe(200);
    expect(mockClosePosition).toHaveBeenCalledWith({
      userId: 'user-1',
      positionId: 'pos-1',
      percentage: undefined,
      maxSlippage: undefined,
    });
  });

  it('treats an empty object body as a full market close', async () => {
    await POST(closeRequest('{}'), context);

    expect(mockClosePosition).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: undefined, maxSlippage: undefined })
    );
  });

  it('passes a validated partial close through', async () => {
    await POST(closeRequest('{"percentage":0.5,"slippage":0.02}'), context);

    expect(mockClosePosition).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: 0.5, maxSlippage: 0.02 })
    );
  });

  it('rejects malformed JSON without closing the position', async () => {
    await expect(
      POST(closeRequest('{"percentage":0.5'), context)
    ).rejects.toBeInstanceOf(TestBadRequestError);
    expect(mockClosePosition).not.toHaveBeenCalled();
  });

  it('rejects a null or array body without closing the position', async () => {
    await expect(POST(closeRequest('null'), context)).rejects.toThrow();
    await expect(POST(closeRequest('[]'), context)).rejects.toThrow();
    expect(mockClosePosition).not.toHaveBeenCalled();
  });

  it('rejects limit close orders instead of executing at market', async () => {
    await expect(
      POST(closeRequest('{"orderType":"limit","limitPrice":12.5}'), context)
    ).rejects.toBeInstanceOf(TestBadRequestError);
    expect(mockClosePosition).not.toHaveBeenCalled();
  });
});
