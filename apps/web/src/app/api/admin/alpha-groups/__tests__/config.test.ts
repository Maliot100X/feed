import { describe, expect, it, mock } from 'bun:test';
import * as actualApi from '@feed/api';
import { ALPHA_GROUP_CONFIG } from '@feed/engine';
import { NextResponse } from 'next/server';

mock.module('@feed/api', () => ({
  requirePermission: async () => ({ userId: 'admin-1' }),
  successResponse: (data: object) => NextResponse.json(data),
  withErrorHandling: actualApi.withErrorHandling,
}));

const { GET, PATCH } = await import('../config/route');

function patch(body: object) {
  return PATCH(
    new Request('http://localhost/api/admin/alpha-groups/config', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as never
  ) as Promise<Response>;
}

describe('alpha-groups config', () => {
  it('reports the real env var for every engine config key', async () => {
    const res = (await GET(
      new Request('http://localhost/api/admin/alpha-groups/config') as never
    )) as Response;
    const body = await res.json();
    const meta = body.data.configWithMeta as {
      key: string;
      envVar: string;
      description: string;
    }[];
    expect(meta).toHaveLength(Object.keys(ALPHA_GROUP_CONFIG).length);
    expect(meta.find((m) => m.key === 'maxInvitesPerUserPerWeek')?.envVar).toBe(
      'ALPHA_MAX_INVITES_PER_USER_PER_WEEK'
    );
    for (const entry of meta) {
      expect(entry.envVar).toMatch(/^ALPHA_[A-Z_]+$/);
      expect(entry.description).not.toBe('No description available');
    }
  });

  it('rejects unknown keys instead of silently stripping them', async () => {
    expect((await patch({ notAKey: 1 })).status).toBe(400);
  });

  it('accepts fastTrackTargetTier and validates cross-field decay hours', async () => {
    const ok = await patch({ fastTrackTargetTier: 3 });
    expect(ok.status).toBe(200);
    expect((await patch({ fastTrackTargetTier: 1 })).status).toBe(400);
    expect(
      (await patch({ inviteDecayBaseHours: 48, inviteDecayMaxHours: 24 }))
        .status
    ).toBe(400);
  });
});
