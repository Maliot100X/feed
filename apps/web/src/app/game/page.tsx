'use client';

import { cn } from '@feed/shared';
import { Activity } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer } from '@/components/shared/PageContainer';
import { apiUrl } from '@/utils/api-url';

interface GameStats {
  totalPosts: number;
  activeQuestions: number;
  totalCompanies: number;
}

interface EngineStatus {
  currentDay?: number;
  currentDate?: string;
  lastTickAt?: string;
}

export default function GamePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlightRef = useRef(false);

  const loadGameData = useCallback(async () => {
    // Skip overlapping polls/clicks while a request is outstanding.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      const response = await fetch(apiUrl('/api/stats'));
      if (!response.ok) {
        setError('Failed to load game data');
        return;
      }
      const data = (await response.json()) as {
        stats: GameStats;
        engineStatus: EngineStatus;
      };
      setStats(data.stats);
      setEngineStatus(data.engineStatus);
      setError(null);
    } catch {
      setError('Failed to load game data');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadGameData();

    // Refresh every 10 seconds
    const interval = setInterval(loadGameData, 10000);
    return () => clearInterval(interval);
  }, [loadGameData]);

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center">
        <div className="text-lg text-muted-foreground">
          Loading game status...
        </div>
      </PageContainer>
    );
  }

  if (error && !stats) {
    return (
      <PageContainer className="flex flex-col items-center justify-center gap-4">
        <div className="text-destructive text-lg">{error}</div>
        <button
          type="button"
          onClick={() => void loadGameData()}
          disabled={refreshing}
          className="rounded-lg bg-primary px-6 py-2 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {refreshing ? 'Retrying...' : 'Try again'}
        </button>
      </PageContainer>
    );
  }

  const currentDate = engineStatus?.currentDate
    ? new Date(engineStatus.currentDate)
    : null;
  const lastTick = engineStatus?.lastTickAt
    ? new Date(engineStatus.lastTickAt)
    : null;

  return (
    <PageContainer className="overflow-y-auto pb-24 md:pb-4">
      <div className="mx-auto max-w-feed space-y-4 px-4 pt-4">
        {/* Engine Status Card */}
        <div
          className={cn(
            'rounded-2xl border border-border bg-card p-6',
            'shadow-md'
          )}
        >
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="font-bold text-lg">Game Engine</h2>
          </div>
          {error && (
            <p className="mb-3 text-destructive text-sm" role="alert">
              {error} — showing last loaded data.
            </p>
          )}

          {/* Current Game Time */}
          <div className="space-y-2">
            <div>
              <div className="mb-1 text-muted-foreground text-xs">
                Current Game Date
              </div>
              <div className="font-bold text-2xl text-primary">
                {currentDate
                  ? currentDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Unavailable'}
              </div>
              {engineStatus?.currentDay != null && (
                <div className="mt-1 text-muted-foreground text-sm">
                  Day {engineStatus.currentDay}
                </div>
              )}
            </div>

            {lastTick && (
              <div>
                <div className="mb-1 text-muted-foreground text-xs">
                  Last Tick
                </div>
                <div className="text-sm">
                  {lastTick.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Game Stats Card */}
        <div
          className={cn(
            'rounded-2xl border border-border bg-card p-6',
            'shadow-md'
          )}
        >
          <h3 className="mb-4 font-semibold text-sm">Game Statistics</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="mb-1 text-muted-foreground text-xs">
                Total Posts
              </div>
              <div className="font-bold text-2xl text-primary">
                {stats?.totalPosts?.toLocaleString() ?? '—'}
              </div>
            </div>
            <div>
              <div className="mb-1 text-muted-foreground text-xs">
                Active Questions
              </div>
              <div className="font-bold text-2xl text-primary">
                {stats?.activeQuestions?.toLocaleString() ?? '—'}
              </div>
            </div>
            <div>
              <div className="mb-1 text-muted-foreground text-xs">
                Companies
              </div>
              <div className="font-bold text-2xl text-primary">
                {stats?.totalCompanies?.toLocaleString() ?? '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Refresh Button */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadGameData()}
            disabled={refreshing}
            className={cn(
              'rounded-lg px-6 py-3 font-semibold',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'transition-all duration-300'
            )}
          >
            {refreshing ? 'Refreshing...' : 'Refresh Stats'}
          </button>
        </div>

        {/* Info Card */}
        <div
          className={cn(
            'rounded-2xl border border-border bg-card p-6',
            'shadow-md'
          )}
        >
          <h3 className="mb-3 font-semibold text-sm">About the Game</h3>
          <div className="space-y-2 text-muted-foreground text-sm">
            <p>
              The game engine advances on a schedule, generating new posts and
              updating markets automatically.
            </p>
            <p>
              Posts appear in the{' '}
              <span className="font-medium text-foreground">Home</span> feed as
              they&apos;re generated. Prediction markets update in the{' '}
              <span className="font-medium text-foreground">Markets</span> tab.
            </p>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
