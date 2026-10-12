/**
 * Feedback Tab Component for Admin Dashboard
 *
 * Displays game feedback submissions with filtering, search, and Linear integration.
 *
 * Features:
 * - View all game feedback (bugs, feature requests, performance issues)
 * - Filter by feedback type
 * - Filter by Linear sync status
 * - Search in descriptions
 * - View screenshots and Linear issue links
 * - Statistics overview
 */
'use client';

import {
  cn,
  FEEDBACK_TYPE_CONFIG,
  type FeedbackType,
  logger,
} from '@feed/shared';
import {
  AlertTriangle,
  Bug,
  ExternalLink,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  type LucideIcon,
  RefreshCw,
  Search,
  Star,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/shared/Avatar';
import { Skeleton } from '@/components/shared/Skeleton';
import { apiUrl } from '@/utils/api-url';

/**
 * Feedback item structure from API
 */
interface FeedbackItem {
  id: string;
  feedbackType: string;
  description: string | null;
  score: number;
  rating: number | null;
  stepsToReproduce: string | null;
  screenshotUrl: string | null;
  linearIssue: {
    id: string;
    identifier: string | null;
    url: string | null;
  } | null;
  createdAt: string;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    profileImageUrl: string | null;
    email: string | null;
  } | null;
}

/**
 * API response structure
 */
interface FeedbackResponse {
  feedback: FeedbackItem[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  stats: {
    total: number;
    byType: Record<string, number>;
  };
}

/**
 * Filter types
 */
type FeedbackTypeFilter = 'all' | FeedbackType;
type LinearFilter = 'all' | 'synced' | 'not_synced';

/**
 * UI-specific feedback type config.
 * Extends shared FEEDBACK_TYPE_CONFIG with icons and colors for the admin UI.
 */
interface FeedbackTypeUIConfig {
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

const FEEDBACK_TYPE_UI_CONFIG: Record<
  FeedbackType | 'unknown',
  FeedbackTypeUIConfig
> = {
  bug: {
    label: FEEDBACK_TYPE_CONFIG.bug.label,
    icon: Bug,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
  feature_request: {
    label: FEEDBACK_TYPE_CONFIG.feature_request.label,
    icon: Lightbulb,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  performance: {
    label: FEEDBACK_TYPE_CONFIG.performance.label,
    icon: Zap,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  unknown: {
    label: 'Unknown',
    icon: AlertTriangle,
    color: 'text-gray-500',
    bgColor: 'bg-gray-500/10',
  },
};

export function FeedbackTab() {
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [stats, setStats] = useState<FeedbackResponse['stats'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FeedbackTypeFilter>('all');
  const [linearFilter, setLinearFilter] = useState<LinearFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(
    null
  );
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  });
  // Bumped by Refresh/Try again to force a refetch with unchanged filters.
  const [refreshKey, setRefreshKey] = useState(0);
  // Sync state is keyed to the feedback item so A's failure never shows on B.
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch feedback when filters change or a refresh is requested.
  // Aborting on cleanup ensures a late response for an old filter/search
  // can never overwrite the current results.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an intentional refetch trigger
  useEffect(() => {
    const controller = new AbortController();
    const fetchFeedback = async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: '50' });

      if (typeFilter !== 'all') {
        params.set('type', typeFilter);
      }
      if (linearFilter === 'synced') {
        params.set('hasLinearIssue', 'true');
      } else if (linearFilter === 'not_synced') {
        params.set('hasLinearIssue', 'false');
      }
      if (debouncedSearch.trim()) {
        params.set('search', debouncedSearch.trim());
      }

      try {
        const response = await fetch(apiUrl(`/api/admin/feedback?${params}`), {
          signal: controller.signal,
        });
        if (!response.ok) {
          logger.error(
            'Failed to fetch feedback',
            { status: response.status },
            'FeedbackTab'
          );
          setError(`Failed to load feedback (${response.status})`);
          return;
        }

        const data: FeedbackResponse = await response.json();
        setFeedback(data.feedback);
        setStats(data.stats);
        setPagination(data.pagination);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : 'Failed to load feedback'
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void fetchFeedback();
    return () => controller.abort();
  }, [typeFilter, linearFilter, debouncedSearch, refreshKey]);

  // Escape key to close modal
  useEffect(() => {
    if (!selectedFeedback) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedFeedback(null);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedFeedback]);

  // Manual refresh function for button
  const handleRefresh = () => {
    setDebouncedSearch(searchQuery);
    setRefreshKey((key) => key + 1);
  };

  // Retry Linear sync for a feedback item
  const handleRetrySync = useCallback(
    async (feedbackId: string) => {
      setSyncingId(feedbackId);
      setSyncError(null);

      try {
        const response = await fetch(
          apiUrl(
            `/api/admin/feedback/${encodeURIComponent(feedbackId)}/retry-sync`
          ),
          { method: 'POST' }
        );

        if (!response.ok) {
          const errorText = await response.text();
          setSyncError({
            id: feedbackId,
            message: `Sync failed (HTTP ${response.status}): ${errorText}`,
          });
          return;
        }

        const data: { linearIssue?: FeedbackItem['linearIssue'] } =
          await response.json();
        const linearIssue = data.linearIssue;
        if (!linearIssue) return;

        // A synced item no longer belongs in the "not synced" view.
        setFeedback((prev) =>
          linearFilter === 'not_synced'
            ? prev.filter((item) => item.id !== feedbackId)
            : prev.map((item) =>
                item.id === feedbackId ? { ...item, linearIssue } : item
              )
        );
        setSelectedFeedback((prev) =>
          prev?.id === feedbackId ? { ...prev, linearIssue } : prev
        );
      } catch (err) {
        setSyncError({
          id: feedbackId,
          message: err instanceof Error ? err.message : 'Sync failed',
        });
      } finally {
        setSyncingId((current) => (current === feedbackId ? null : current));
      }
    },
    [linearFilter]
  );

  const getTypeConfig = (type: string): FeedbackTypeUIConfig => {
    return (
      FEEDBACK_TYPE_UI_CONFIG[type as keyof typeof FEEDBACK_TYPE_UI_CONFIG] ??
      FEEDBACK_TYPE_UI_CONFIG.unknown
    );
  };

  if (loading && feedback.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-muted-foreground text-sm">Total Feedback</div>
            <div className="mt-1 font-bold text-2xl">{stats.total}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm">
              <Bug className="h-4 w-4 text-red-500" />
              <span className="text-muted-foreground">Bugs</span>
            </div>
            <div className="mt-1 font-bold text-2xl">
              {stats.byType.bug ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">Features</span>
            </div>
            <div className="mt-1 font-bold text-2xl">
              {stats.byType.feature_request ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-blue-500" />
              <span className="text-muted-foreground">Performance</span>
            </div>
            <div className="mt-1 font-bold text-2xl">
              {stats.byType.performance ?? 0}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search feedback..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background pr-4 pl-10 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Type Filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as FeedbackTypeFilter)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Types</option>
          <option value="bug">Bug Reports</option>
          <option value="feature_request">Feature Requests</option>
          <option value="performance">Performance Issues</option>
        </select>

        {/* Linear Filter */}
        <select
          value={linearFilter}
          onChange={(e) => setLinearFilter(e.target.value as LinearFilter)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Sync Status</option>
          <option value="synced">Synced to Linear</option>
          <option value="not_synced">Not Synced</option>
        </select>

        {/* Refresh */}
        <button
          type="button"
          onClick={handleRefresh}
          className="h-10 rounded-lg border border-border bg-background px-4 text-sm hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-2 text-sm underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Feedback List */}
      <div className="space-y-3">
        {feedback.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">No feedback found</p>
          </div>
        ) : (
          feedback.map((item) => {
            const config = getTypeConfig(item.feedbackType);
            const Icon = config.icon;

            return (
              <div
                key={item.id}
                onClick={() => setSelectedFeedback(item)}
                className={cn(
                  'cursor-pointer rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50',
                  selectedFeedback?.id === item.id && 'border-primary'
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Type Icon */}
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                      config.bgColor
                    )}
                  >
                    <Icon className={cn('h-5 w-5', config.color)} />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 font-medium text-xs',
                          config.bgColor,
                          config.color
                        )}
                      >
                        {config.label}
                      </span>
                      {item.rating && (
                        <span className="flex items-center gap-1 text-muted-foreground text-xs">
                          <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                          {item.rating}/5
                        </span>
                      )}
                      {item.screenshotUrl && (
                        <span className="text-muted-foreground text-xs">
                          <ImageIcon className="inline h-3 w-3" /> Has
                          screenshot
                        </span>
                      )}
                      {item.linearIssue && (
                        <a
                          href={item.linearIssue.url ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-primary text-xs hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {item.linearIssue.identifier}
                        </a>
                      )}
                    </div>

                    <p className="line-clamp-2 text-sm">
                      {item.description ?? 'No description'}
                    </p>

                    <div className="mt-2 flex items-center gap-3 text-muted-foreground text-xs">
                      {item.user && (
                        <div className="flex items-center gap-1.5">
                          <Avatar
                            src={item.user.profileImageUrl ?? undefined}
                            name={
                              item.user.displayName ?? item.user.username ?? '?'
                            }
                            size="sm"
                          />
                          <span>
                            {item.user.displayName ?? item.user.username}
                          </span>
                        </div>
                      )}
                      <span>
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Info */}
      {pagination.total > 0 && (
        <div className="text-center text-muted-foreground text-sm">
          Showing {feedback.length} of {pagination.total} feedback items
        </div>
      )}

      {/* Selected Feedback Detail Modal */}
      {selectedFeedback && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-modal-title"
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedFeedback(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                {(() => {
                  const config = getTypeConfig(selectedFeedback.feedbackType);
                  const Icon = config.icon;
                  return (
                    <>
                      <div
                        className={cn(
                          'flex h-12 w-12 items-center justify-center rounded-xl',
                          config.bgColor
                        )}
                      >
                        <Icon className={cn('h-6 w-6', config.color)} />
                      </div>
                      <div>
                        <h3
                          id="feedback-modal-title"
                          className="font-bold text-lg"
                        >
                          {config.label}
                        </h3>
                        <p className="text-muted-foreground text-sm">
                          ID: {selectedFeedback.id}
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {/* Description */}
            <div className="mb-4">
              <h4 className="mb-2 font-medium text-sm">Description</h4>
              <p className="rounded-lg bg-muted p-3 text-sm">
                {selectedFeedback.description ?? 'No description provided'}
              </p>
            </div>

            {/* Steps to Reproduce (for bugs) */}
            {selectedFeedback.stepsToReproduce && (
              <div className="mb-4">
                <h4 className="mb-2 font-medium text-sm">Steps to Reproduce</h4>
                <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-sm">
                  {selectedFeedback.stepsToReproduce}
                </pre>
              </div>
            )}

            {/* Screenshot */}
            {selectedFeedback.screenshotUrl && (
              <div className="mb-4">
                <h4 className="mb-2 font-medium text-sm">Screenshot</h4>
                <a
                  href={selectedFeedback.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={selectedFeedback.screenshotUrl}
                    alt="Feedback screenshot"
                    className="max-h-64 rounded-lg border border-border object-contain"
                  />
                </a>
              </div>
            )}

            {/* Rating */}
            {selectedFeedback.rating && (
              <div className="mb-4">
                <h4 className="mb-2 font-medium text-sm">Importance Rating</h4>
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        'h-5 w-5',
                        i < selectedFeedback.rating!
                          ? 'fill-amber-500 text-amber-500'
                          : 'text-muted-foreground'
                      )}
                    />
                  ))}
                  <span className="ml-2 text-muted-foreground text-sm">
                    ({selectedFeedback.rating}/5)
                  </span>
                </div>
              </div>
            )}

            {/* Linear Issue */}
            <div className="mb-4">
              <h4 className="mb-2 font-medium text-sm">Linear Issue</h4>
              {selectedFeedback.linearIssue ? (
                selectedFeedback.linearIssue.url?.startsWith('https://') ? (
                  <a
                    href={selectedFeedback.linearIssue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-primary text-sm hover:bg-primary/20"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {selectedFeedback.linearIssue.identifier ??
                      selectedFeedback.linearIssue.id}
                  </a>
                ) : (
                  <span className="text-sm">
                    {selectedFeedback.linearIssue.identifier ??
                      selectedFeedback.linearIssue.id}
                  </span>
                )
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-sm">
                    Not synced to Linear
                  </p>
                  <button
                    type="button"
                    onClick={() => handleRetrySync(selectedFeedback.id)}
                    disabled={syncingId === selectedFeedback.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
                  >
                    {syncingId === selectedFeedback.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {syncingId === selectedFeedback.id
                      ? 'Syncing...'
                      : 'Retry Sync to Linear'}
                  </button>
                  {syncError?.id === selectedFeedback.id && (
                    <p className="text-red-500 text-sm">{syncError.message}</p>
                  )}
                </div>
              )}
            </div>

            {/* Submitter */}
            {selectedFeedback.user && (
              <div className="mb-4">
                <h4 className="mb-2 font-medium text-sm">Submitted By</h4>
                <div className="flex items-center gap-3">
                  <Avatar
                    src={selectedFeedback.user.profileImageUrl ?? undefined}
                    name={
                      selectedFeedback.user.displayName ??
                      selectedFeedback.user.username ??
                      '?'
                    }
                    size="md"
                  />
                  <div>
                    <div className="font-medium">
                      {selectedFeedback.user.displayName ??
                        selectedFeedback.user.username}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {selectedFeedback.user.email ?? 'No email'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="border-border border-t pt-4 text-muted-foreground text-sm">
              <div className="flex justify-between">
                <span>Score: {selectedFeedback.score}</span>
                <span>
                  Submitted:{' '}
                  {new Date(selectedFeedback.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
