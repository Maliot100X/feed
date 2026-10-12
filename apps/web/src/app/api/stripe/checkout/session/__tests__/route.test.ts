import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

const createSessionMock = mock(
  async (): Promise<{
    id: string;
    url: string | null;
  }> => ({
    id: 'cs_test',
    url: 'https://checkout.stripe.test/cs_test',
  })
);

class ServiceUnavailableError extends Error {}

const apiModulePath = new URL(
  '../../../../../../../../../packages/api/src/index.ts',
  import.meta.url
).pathname;
const apiModuleFactory = () => ({
  authenticate: async () => ({ userId: 'u1', dbUserId: 'u1' }),
  ServiceUnavailableError,
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
});

mock.module('@feed/api', apiModuleFactory);
mock.module(apiModulePath, apiModuleFactory);
mock.module('@/lib/posthog/server', () => ({
  trackServerEvent: async () => undefined,
}));
mock.module('@/lib/stripe/server', () => ({
  calculatePointsFromUSD: (amount: number) => Math.floor(amount * 100),
  getBaseUrl: () => 'https://feed.example',
  POINTS_CONFIG: { CURRENCY: 'usd' },
  stripe: { checkout: { sessions: { create: createSessionMock } } },
  validatePurchaseAmount: (amount: number) =>
    amount >= 1 && amount <= 1000
      ? { valid: true }
      : { valid: false, error: 'Invalid amount' },
}));

function post(body: string): NextRequest {
  return new NextRequest('https://feed.example/api/stripe/checkout/session', {
    method: 'POST',
    body,
  });
}

describe('POST /api/stripe/checkout/session', () => {
  beforeEach(() => {
    createSessionMock.mockClear();
  });

  it.each([
    ['null', 'null'],
    ['string amount', '{"amountUSD":"10"}'],
    ['array', '[]'],
  ])('rejects a %s body with 400', async (_label, raw) => {
    const { POST } = await import('../route');
    const response = await POST(post(raw));
    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('fails when Stripe returns no redirect url', async () => {
    createSessionMock.mockImplementationOnce(async () => ({
      id: 'cs_test',
      url: null,
    }));
    const { POST } = await import('../route');
    await expect(POST(post('{"amountUSD":10}'))).rejects.toBeInstanceOf(
      ServiceUnavailableError
    );
  });

  it('creates a session for a valid amount', async () => {
    const { POST } = await import('../route');
    const response = await POST(post('{"amountUSD":10}'));
    expect(response.status).toBe(200);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });
});
