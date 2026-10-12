import { describe, expect, it, mock } from 'bun:test';
import type { NextRequest } from 'next/server';

class TestAuthError extends Error {}

const mockRequireAdmin = mock(async () => {
  throw new TestAuthError('admin required');
});
const mockValidate = mock(async () => ({
  ready: true,
  issues: [],
  warnings: [],
}));

mock.module('@feed/api', () => ({
  requireAdmin: mockRequireAdmin,
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
}));

mock.module('@feed/shared', () => ({
  logger: { info: mock(), warn: mock(), error: mock() },
}));

mock.module('@feed/training', () => ({
  huggingFaceIntegration: {
    validateSystemReadiness: mockValidate,
    getStatistics: async () => ({}),
    hasNewDataToUpload: async () => false,
  },
}));

const { GET } = await import('../route');

describe('GET /api/huggingface/status', () => {
  it('requires admin before running any diagnostics', async () => {
    await expect(
      GET(
        new Request(
          'http://localhost/api/huggingface/status'
        ) as unknown as NextRequest
      )
    ).rejects.toBeInstanceOf(TestAuthError);
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('does not report a hardcoded schedule', async () => {
    mockRequireAdmin.mockResolvedValueOnce(undefined as never);

    const response = (await GET(
      new Request(
        'http://localhost/api/huggingface/status'
      ) as unknown as NextRequest
    )) as Response;
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('nextScheduledRun');
  });
});
