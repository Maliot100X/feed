/**
 * Training Dashboard Admin Panel
 *
 * @description Complete monitoring and control interface for the RL training system.
 * Provides real-time status updates, training readiness checks, job management,
 * and system health monitoring. Allows admins to trigger training jobs and view
 * training metrics.
 *
 * @page /admin/training
 * @access Admin only
 *
 * @features
 * - Real-time training status updates (refreshes every 5 seconds)
 * - Data collection statistics (24h, 7d, rate per hour)
 * - Training readiness checks (trajectories, scenario groups, data quality)
 * - Current model version tracking
 * - Training job management
 * - System health monitoring (database, storage, W&B)
 * - Manual training trigger
 * - W&B integration links
 *
 * @example
 * ```tsx
 * // Accessible at /admin/training
 * // Requires admin privileges
 * <TrainingDashboard />
 * ```
 */

'use client';

import { logger } from '@feed/shared';
import {
  AlertCircle,
  Cpu,
  Database,
  Loader2,
  PlayCircle,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiUrl } from '@/utils/api-url';

/**
 * Training job information
 */
interface TrainingJob {
  id: string;
  modelVersion: string;
  status: string;
  createdAt: string | Date;
}

/**
 * Training model information
 */
interface TrainingModel {
  id: string;
  version: string;
  status: string;
}

/**
 * Complete training system status
 */
interface TrainingStatus {
  status: string;
  automation: {
    dataCollection: {
      last24h: number;
      last7d: number;
      ratePerHour: number;
    };
    training: {
      currentJob: string | null;
      lastCompleted: Date | null;
      nextScheduled: Date | null;
    };
    models: {
      latest: string | null;
      deployed: number;
      training: number;
    };
    health: {
      database: boolean;
      storage: boolean;
    };
  };
  readiness: {
    ready: boolean;
    reason: string;
    stats: {
      totalTrajectories: number;
      unscoredTrajectories: number;
      scenarioGroups: number;
      dataQuality: number;
    };
    thresholds: {
      minTrajectories: number;
      minScenarioGroups: number;
      minDataQuality: number;
    };
  };
  recentJobs: TrainingJob[];
  models: TrainingModel[];
  trajectoryStats: {
    last1h?: number;
    last24h?: number;
    last7d?: number;
  };
}

/**
 * Training Dashboard Component
 *
 * @description Main component for the RL training dashboard admin panel.
 * Displays training status, readiness metrics, job history, and system health.
 * Allows admins to trigger training jobs manually.
 *
 * @returns {JSX.Element} Training dashboard page
 */
export default function TrainingDashboard() {
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/admin/training/status'));
      if (!res.ok) {
        logger.error(
          'Failed to load training status',
          { status: res.status },
          'TrainingAdmin'
        );
        setLoadError(`Failed to load training status (HTTP ${res.status})`);
        return;
      }
      const data: TrainingStatus = await res.json();
      setStatus(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load training status'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(() => void loadStatus(), 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, [loadStatus]);

  async function triggerTraining() {
    if (training) return;
    setTraining(true);

    let started: { jobId?: string } | null = null;
    try {
      const res = await fetch(apiUrl('/api/admin/training/trigger'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      const body: { success?: boolean; jobId?: string; error?: string } =
        await res.json().catch(() => ({}));

      if (!res.ok || !body.success) {
        toast.error(
          body.error ?? `Failed to trigger training (HTTP ${res.status})`
        );
        return;
      }
      started = body;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to trigger training'
      );
      return;
    } finally {
      setTraining(false);
    }

    // The job was accepted; a failed status refresh is not a start failure.
    toast.success(`Training started! Job ID: ${started?.jobId ?? 'unknown'}`);
    await loadStatus();
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center md:min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="space-y-4 p-8">
        <div className="text-red-500">
          {loadError ?? 'Failed to load training status'}
        </div>
        <Button onClick={() => void loadStatus()}>Retry</Button>
      </div>
    );
  }

  const { automation, readiness } = status;
  const { thresholds } = readiness;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl">RL Training Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor and control automated training pipeline
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => void triggerTraining()}
            disabled={
              training || !!automation.training.currentJob || !readiness.ready
            }
            title={
              automation.training.currentJob
                ? 'A training job is already running'
                : readiness.ready
                  ? undefined
                  : `Not ready: ${readiness.reason}`
            }
            size="lg"
          >
            {training ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                Train Now
              </>
            )}
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="rounded border border-destructive bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {loadError} — showing last loaded status.
        </div>
      )}

      {/* Data Collection Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Trajectories (24h)
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {automation.dataCollection.last24h}
            </div>
            <p className="text-muted-foreground text-xs">
              {automation.dataCollection.ratePerHour.toFixed(1)}/hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Ready for Training
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {readiness.stats.totalTrajectories}
            </div>
            <p className="text-muted-foreground text-xs">
              {readiness.stats.scenarioGroups} scenario groups
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">Current Model</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {automation.models.latest || 'None'}
            </div>
            <p className="text-muted-foreground text-xs">
              {automation.models.deployed} deployed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">Data Quality</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {(readiness.stats.dataQuality * 100).toFixed(0)}%
            </div>
            <p className="text-muted-foreground text-xs">
              {readiness.ready ? '✅ Ready' : '⏳ Collecting'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Training Readiness */}
      <Card>
        <CardHeader>
          <CardTitle>Training Readiness</CardTitle>
          <CardDescription>
            {readiness.ready ? '✅ Ready to train!' : `⏳ ${readiness.reason}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Trajectories:</span>
              <Badge
                variant={
                  readiness.stats.totalTrajectories >=
                  thresholds.minTrajectories
                    ? 'default'
                    : 'secondary'
                }
              >
                {readiness.stats.totalTrajectories} /{' '}
                {thresholds.minTrajectories}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>Scenario Groups:</span>
              <Badge
                variant={
                  readiness.stats.scenarioGroups >= thresholds.minScenarioGroups
                    ? 'default'
                    : 'secondary'
                }
              >
                {readiness.stats.scenarioGroups} /{' '}
                {thresholds.minScenarioGroups}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>Data Quality:</span>
              <Badge
                variant={
                  readiness.stats.dataQuality >= thresholds.minDataQuality
                    ? 'default'
                    : 'secondary'
                }
              >
                {(readiness.stats.dataQuality * 100).toFixed(1)}% /{' '}
                {(thresholds.minDataQuality * 100).toFixed(0)}%
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Training Status */}
      {automation.training.currentJob && (
        <Card>
          <CardHeader>
            <CardTitle>Training In Progress</CardTitle>
            <CardDescription>
              Job ID: {automation.training.currentJob}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Running — progress and ETA are not reported by the pipeline.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Jobs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Training Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {status.recentJobs.map((job: TrainingJob) => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded border p-2"
              >
                <div>
                  <div className="font-medium">{job.modelVersion}</div>
                  <div className="text-muted-foreground text-sm">
                    {new Date(job.createdAt).toLocaleString()}
                  </div>
                </div>
                <Badge
                  variant={
                    job.status === 'completed'
                      ? 'default'
                      : job.status === 'training'
                        ? 'secondary'
                        : job.status === 'failed'
                          ? 'destructive'
                          : 'outline'
                  }
                >
                  {job.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Health */}
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Database:</span>
              <Badge
                variant={automation.health.database ? 'default' : 'destructive'}
              >
                {automation.health.database ? '✅ Healthy' : '❌ Error'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span>Storage:</span>
              <Badge
                variant={
                  automation.health.storage === null
                    ? 'outline'
                    : automation.health.storage
                      ? 'default'
                      : 'destructive'
                }
              >
                {automation.health.storage === null
                  ? 'N/A (R2)'
                  : automation.health.storage
                    ? '✅ Healthy'
                    : '❌ Error'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
