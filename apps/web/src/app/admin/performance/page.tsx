/**
 * Admin Performance Dashboard
 *
 * Read-only view of database query performance and server process metrics.
 * Load generation is not hosted by the application; use the isolated
 * harness in `packages/testing/load-test` against a disposable environment.
 */

'use client';

import { cn } from '@feed/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { AdminStandalonePage } from '@/components/admin/AdminStandalonePage';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiUrl } from '@/utils/api-url';

/** 'unknown' = no observations (or no process metrics on this runtime). */
const HealthLevelSchema = z.enum(['healthy', 'warning', 'critical', 'unknown']);
type HealthLevel = z.infer<typeof HealthLevelSchema>;

const NetworkStatsSchema = z.object({
  timestamp: z.string(),
  database: z.object({
    queries: z.object({
      total: z.number(),
      slow: z.number(),
      slowRate: z.number(),
      avgDuration: z.number(),
      p95Duration: z.number(),
      p99Duration: z.number(),
    }),
    topSlowQueries: z.array(
      z.object({
        query: z.string(),
        count: z.number(),
        avgDuration: z.number(),
        maxDuration: z.number(),
      })
    ),
  }),
  server: z.object({
    /** null on Cloudflare Workers, which have no per-process metrics. */
    uptime: z.object({ formatted: z.string() }).nullable(),
    memory: z
      .object({ heapUsed: z.number(), heapTotal: z.number() })
      .nullable(),
    env: z.string().optional(),
    pid: z.number(),
  }),
  health: z.object({
    database: HealthLevelSchema,
    memory: HealthLevelSchema,
    overall: HealthLevelSchema,
  }),
});
type NetworkStats = z.infer<typeof NetworkStatsSchema>;

const HEALTH_BADGE_CLASS: Record<HealthLevel, string> = {
  healthy: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  critical: 'bg-red-100 text-red-800',
  unknown: 'bg-gray-100 text-gray-800',
};

const CARD_CLASS = 'rounded-lg border p-4';

function HealthBadge({ level }: { level: HealthLevel }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs',
        HEALTH_BADGE_CLASS[level]
      )}
    >
      {level.toUpperCase()}
    </span>
  );
}

export default function AdminPerformancePage() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const inFlight = useRef(false);

  const fetchStats = useCallback(async () => {
    // Skip overlapping polls; the in-flight request will deliver fresh data.
    if (inFlight.current) return;
    inFlight.current = true;
    setIsFetching(true);
    try {
      const response = await fetch(apiUrl('/api/admin/network-stats'));
      if (!response.ok) {
        setError(`Failed to fetch stats (HTTP ${response.status})`);
        return;
      }
      const parsed = NetworkStatsSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError('Unexpected network stats response shape');
        return;
      }
      setStats(parsed.data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch network stats'
      );
    } finally {
      inFlight.current = false;
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
    if (!autoRefresh) return undefined;
    const interval = setInterval(() => {
      void fetchStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStats]);

  return (
    <AdminStandalonePage className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-3xl">Performance Dashboard</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (5s)
          </label>
          <Button
            onClick={() => void fetchStats()}
            variant="outline"
            size="sm"
            disabled={isFetching}
          >
            Refresh Now
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive bg-destructive/10 px-4 py-3 text-destructive">
          {error}
          {stats && (
            <span className="ml-2 text-sm">
              (showing data from{' '}
              {new Date(stats.timestamp).toLocaleTimeString()})
            </span>
          )}
        </div>
      )}

      {!stats && !error && (
        <div className="text-muted-foreground text-sm">Loading…</div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card className={CARD_CLASS}>
              <CardHeader className="mb-4 pb-3">
                <CardTitle className="font-medium text-sm">
                  Overall Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HealthBadge level={stats.health.overall} />
              </CardContent>
            </Card>

            <Card className={CARD_CLASS}>
              <CardHeader className="mb-4 pb-3">
                <CardTitle className="font-medium text-sm">Database</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <HealthBadge level={stats.health.database} />
                <span className="text-muted-foreground text-sm">
                  {stats.database.queries.slowRate.toFixed(1)}% slow
                </span>
              </CardContent>
            </Card>

            <Card className={CARD_CLASS}>
              <CardHeader className="mb-4 pb-3">
                <CardTitle className="font-medium text-sm">Memory</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <HealthBadge level={stats.health.memory} />
                {stats.server.memory && (
                  <span className="text-muted-foreground text-sm">
                    {stats.server.memory.heapUsed.toFixed(0)}MB /{' '}
                    {stats.server.memory.heapTotal.toFixed(0)}MB
                  </span>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className={CARD_CLASS}>
            <CardHeader className="mb-4">
              <CardTitle className="font-semibold text-lg">
                Database Performance
              </CardTitle>
              <CardDescription className="text-muted-foreground text-sm">
                Query metrics from the last 60 seconds
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
                {[
                  {
                    label: 'Total Queries',
                    value: stats.database.queries.total.toLocaleString(),
                  },
                  {
                    label: 'Slow Queries',
                    value: String(stats.database.queries.slow),
                  },
                  {
                    label: 'Avg Duration',
                    value: `${stats.database.queries.avgDuration.toFixed(1)}ms`,
                  },
                  {
                    label: '95th Percentile',
                    value: `${stats.database.queries.p95Duration.toFixed(1)}ms`,
                  },
                  {
                    label: '99th Percentile',
                    value: `${stats.database.queries.p99Duration.toFixed(1)}ms`,
                  },
                  {
                    label: 'Slow Rate',
                    value: `${stats.database.queries.slowRate.toFixed(1)}%`,
                  },
                ].map((metric) => (
                  <div key={metric.label}>
                    <div className="font-bold text-2xl">{metric.value}</div>
                    <div className="text-muted-foreground text-xs">
                      {metric.label}
                    </div>
                  </div>
                ))}
              </div>

              {stats.database.topSlowQueries.length > 0 && (
                <div>
                  <h3 className="mb-2 font-semibold">Top Slow Queries</h3>
                  <div className="space-y-2">
                    {stats.database.topSlowQueries.map((query) => (
                      <div
                        key={query.query}
                        className="flex items-center justify-between border-b pb-2 text-sm"
                      >
                        <div className="flex-1">
                          <div className="font-mono">{query.query}</div>
                          <div className="text-muted-foreground text-xs">
                            Count: {query.count}
                          </div>
                        </div>
                        <div className="text-right">
                          <div>Avg: {query.avgDuration.toFixed(1)}ms</div>
                          <div className="text-muted-foreground text-xs">
                            Max: {query.maxDuration.toFixed(1)}ms
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={CARD_CLASS}>
            <CardHeader className="mb-4">
              <CardTitle className="font-semibold text-lg">
                Server Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <div className="font-semibold">Uptime</div>
                  <div>{stats.server.uptime?.formatted ?? '—'}</div>
                </div>
                <div>
                  <div className="font-semibold">Environment</div>
                  <div>{stats.server.env ?? 'unknown'}</div>
                </div>
                <div>
                  <div className="font-semibold">Process ID</div>
                  <div>{stats.server.pid}</div>
                </div>
                <div>
                  <div className="font-semibold">Last Updated</div>
                  <div>{new Date(stats.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </AdminStandalonePage>
  );
}
