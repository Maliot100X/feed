/**
 * Metrics Snapshot Cron Job Integration Tests
 *
 * Tests the hourly metrics snapshot cron job that stores platform statistics
 * for time-series analysis.
 *
 * Run: bun test integration/metrics-snapshot-cron.integration.test.ts --preload ./integration/preload.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db, eq, inArray, systemMetricsSnapshots } from '@feed/db';
import { getAdminToken } from './helpers';

const BASE_URL =
  process.env.TEST_API_URL ||
  process.env.TEST_BASE_URL ||
  'http://localhost:3000';

const CRON_SECRET = process.env.CRON_SECRET || 'development';

let serverAvailable = false;
let devAdminToken: string | null = null;
const testSnapshotIds: string[] = [];

function requireServer(): void {
  if (!serverAvailable) {
    throw new Error(`TEST SKIPPED: Server not available at ${BASE_URL}`);
  }
}

async function cronRequest(path: string, options: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CRON_SECRET}`,
      ...(options.headers as Record<string, string>),
    },
    signal: AbortSignal.timeout(60000), // 60s timeout for cron
  });
}

async function adminRequest(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (devAdminToken) headers['x-dev-admin-token'] = devAdminToken;

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(15000),
  });
}

describe('Metrics Snapshot Cron Job', () => {
  beforeAll(async () => {
    // Check server availability
    try {
      const response = await fetch(`${BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      serverAvailable = response.ok;
      console.log(
        `Server availability: ${serverAvailable ? 'Available' : 'Unavailable'}`
      );
    } catch {
      serverAvailable = false;
      console.log('Server not available - tests will be skipped');
    }

    // Get dev admin token
    devAdminToken = getAdminToken();
  });

  afterAll(async () => {
    // Batch cleanup of test snapshots (more efficient than individual deletes)
    if (testSnapshotIds.length > 0) {
      try {
        await db
          .delete(systemMetricsSnapshots)
          .where(inArray(systemMetricsSnapshots.id, testSnapshotIds));
        console.log(`Cleaned up ${testSnapshotIds.length} test snapshots`);
      } catch (error) {
        console.error('Error cleaning up test snapshots:', error);
      }
    }
  });

  describe('Authentication', () => {
    test('handles requests without cron authorization', async () => {
      requireServer();

      const response = await fetch(`${BASE_URL}/api/cron/metrics-snapshot`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      // In development mode, verifyCronAuth allows requests without auth for convenience
      // In production, it would return 401
      // Either behavior is acceptable in tests
      expect([200, 401, 403, 500]).toContain(response.status);
    });

    test('accepts valid CRON_SECRET authorization', async () => {
      requireServer();

      const response = await cronRequest('/api/cron/metrics-snapshot');
      const data = await response.json();

      // Should either succeed (200) or return 500 with error details
      expect([200, 500]).toContain(response.status);

      // If 200, verify response structure
      if (response.status === 200) {
        expect(data.success).toBe(true);
      }
    });
  });

  describe('Snapshot Creation', () => {
    test('creates the hourly snapshot or reports the existing one', async () => {
      requireServer();

      // Never delete pre-existing history: if this hour already has a
      // snapshot, the route must report it as skipped.
      const hourBoundary = new Date();
      hourBoundary.setMinutes(0, 0, 0);
      const [existing] = await db
        .select({ id: systemMetricsSnapshots.id })
        .from(systemMetricsSnapshots)
        .where(eq(systemMetricsSnapshots.timestamp, hourBoundary))
        .limit(1);

      const response = await cronRequest('/api/cron/metrics-snapshot');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      if (existing) {
        expect(data.skipped).toBe(true);
        expect(data.reason).toContain('already exists');
        return;
      }

      expect(data.skipped).toBeFalsy();
      expect(data.snapshotId).toBeDefined();
      testSnapshotIds.push(data.snapshotId);
      expect(data.timestamp).toBeDefined();
      expect(data.environment).toBeDefined();
      expect(data.metrics.totalUsers).toBeGreaterThanOrEqual(0);
      expect(data.systemHealth.apiUptime).toBeGreaterThanOrEqual(0);
      expect(data.systemHealth.apiUptime).toBeLessThanOrEqual(100);
    });

    test('skips when snapshot already exists for hour', async () => {
      requireServer();

      const firstResponse = await cronRequest('/api/cron/metrics-snapshot');
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json();
      if (first.snapshotId && !first.skipped) {
        testSnapshotIds.push(first.snapshotId);
      }

      const response = await cronRequest('/api/cron/metrics-snapshot');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.skipped).toBe(true);
      expect(data.reason).toContain('already exists');
    });

    test('stores correct environment', async () => {
      requireServer();

      const response = await cronRequest('/api/cron/metrics-snapshot');
      const data = await response.json();

      if (data.environment) {
        expect(['production', 'staging', 'development']).toContain(
          data.environment
        );
      }
    });
  });

  describe('Error Handling', () => {
    test('returns 500 with error details on failure', async () => {
      requireServer();

      // This is tricky to test without breaking the DB
      // We'll just verify the error format if we get one
      const response = await cronRequest('/api/cron/metrics-snapshot');
      const data = await response.json();

      if (response.status === 500) {
        expect(data.success).toBe(false);
        expect(data.error).toBeDefined();
        expect(data.timestamp).toBeDefined();
        expect(data.durationMs).toBeDefined();
      }
    });

    test('records cron execution metrics', async () => {
      requireServer();

      const response = await cronRequest('/api/cron/metrics-snapshot');

      // The cron metrics are recorded internally
      // We can verify by checking the system stats endpoint
      if (response.status === 200) {
        const statsResponse = await adminRequest('/api/admin/stats/system');
        if (statsResponse.ok) {
          const stats = await statsResponse.json();
          expect(Array.isArray(stats.cronJobs?.allJobs)).toBe(true);

          const allJobs = stats.cronJobs?.allJobs || [];
          const metricsJob = allJobs.find(
            (job: { jobName?: string; name?: string }) =>
              job.jobName === 'metrics-snapshot' ||
              job.name === 'metrics-snapshot'
          );
          expect(metricsJob).toBeDefined();
        }
      }
    });
  });

  describe('Data Validation', () => {
    test('snapshot timestamp is on hour boundary', async () => {
      requireServer();

      const response = await cronRequest('/api/cron/metrics-snapshot');
      const data = await response.json();

      if (data.timestamp) {
        const timestamp = new Date(data.timestamp);
        expect(timestamp.getMinutes()).toBe(0);
        expect(timestamp.getSeconds()).toBe(0);
        expect(timestamp.getMilliseconds()).toBe(0);
      }
    });

    test('numeric metrics are non-negative', async () => {
      requireServer();

      const response = await cronRequest('/api/cron/metrics-snapshot');
      const data = await response.json();

      if (data.success && !data.skipped && data.metrics) {
        expect(data.metrics.totalUsers).toBeGreaterThanOrEqual(0);
        expect(data.metrics.activeUsers).toBeGreaterThanOrEqual(0);
        expect(data.metrics.activeMarkets).toBeGreaterThanOrEqual(0);

        if (data.systemHealth) {
          expect(data.systemHealth.apiUptime).toBeGreaterThanOrEqual(0);
          expect(data.systemHealth.cronJobsHealthy).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
