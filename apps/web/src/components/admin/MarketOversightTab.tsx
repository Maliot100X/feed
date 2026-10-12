/**
 * Market Oversight tab for managing prediction markets.
 *
 * Displays market statistics, list of active/expired/resolved markets,
 * and provides actions to resolve, extend, or void markets.
 *
 * Features:
 * - Market statistics overview
 * - Status filtering (active, expired, resolved)
 * - Market list with price/volume info
 * - Resolve market action (YES/NO)
 * - Extend market end date
 * - Void market action
 * - Market detail modal
 * - Loading states
 *
 * @returns Market oversight tab element
 */
'use client';

import { cn, formatCompactCurrency, formatDate } from '@feed/shared';
import {
  AlertTriangle,
  BarChart2,
  Calendar,
  Check,
  Clock,
  DollarSign,
  RefreshCw,
  TrendingUp,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/shared/Skeleton';
import { apiUrl } from '@/utils/api-url';

type MarketStatus = 'all' | 'active' | 'expired' | 'resolved';

interface Market {
  id: string;
  question: string;
  description: string | null;
  yesShares: string;
  noShares: string;
  liquidity: string;
  resolved: boolean;
  resolution: boolean | null;
  endDate: string;
  createdAt: string;
  positionCount: number;
  tradeCount: number;
  totalVolume: number;
  yesPrice: number;
  noPrice: number;
  status: 'active' | 'expired' | 'resolved';
}

interface MarketStats {
  total: number;
  active: number;
  expired: number;
  resolved: number;
  totalLiquidity: number;
  totalPositions: number;
  activePositions: number;
  totalPositionValue: number;
}

interface MarketsData {
  stats: MarketStats;
  markets: Market[];
}

interface MarketActionBody {
  action: 'resolve' | 'extend' | 'void';
  reason?: string;
  resolution?: boolean;
  newEndDate?: string;
}

/**
 * Extract a readable error from a failed response body. JSON bodies (with
 * any leading whitespace) yield their `error`/`message`; anything else is
 * returned as plain text. Never throws on malformed JSON.
 */
export function parseErrorText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      if ('error' in parsed && typeof parsed.error === 'string') {
        return parsed.error;
      }
      if (
        'error' in parsed &&
        parsed.error &&
        typeof parsed.error === 'object' &&
        'message' in parsed.error &&
        typeof parsed.error.message === 'string'
      ) {
        return parsed.error.message;
      }
      if ('message' in parsed && typeof parsed.message === 'string') {
        return parsed.message;
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return trimmed;
}

/** Format a Date as a `datetime-local` input value in the viewer's timezone. */
export function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function MarketOversightTab() {
  const [data, setData] = useState<MarketsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<MarketStatus>('all');
  const [isRefreshing, startRefresh] = useTransition();
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState<'resolve' | 'extend' | 'void'>(
    'resolve'
  );
  const [resolution, setResolution] = useState<boolean>(true);
  const [extendDate, setExtendDate] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [isActioning, startActioning] = useTransition();

  // Only the latest request (e.g. after a filter switch) may update state.
  const latestRequest = useRef(0);

  const fetchMarkets = useCallback(
    (showRefreshing = false) => {
      const fetchLogic = async () => {
        const requestId = ++latestRequest.current;
        const params = new URLSearchParams();
        if (statusFilter !== 'all') params.set('status', statusFilter);

        try {
          const response = await fetch(apiUrl(`/api/admin/markets?${params}`));
          if (requestId !== latestRequest.current) return;
          if (!response.ok) {
            toast.error(`Failed to load market data (HTTP ${response.status})`);
            return;
          }
          const result = await response.json();
          if (requestId !== latestRequest.current) return;
          setData(result);
        } catch (err) {
          if (requestId !== latestRequest.current) return;
          toast.error(
            err instanceof Error ? err.message : 'Failed to load market data'
          );
        } finally {
          if (requestId === latestRequest.current) setLoading(false);
        }
      };

      if (showRefreshing) {
        startRefresh(fetchLogic);
      } else {
        void fetchLogic();
      }
    },
    [statusFilter]
  );

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  const handleAction = (
    market: Market,
    action: 'resolve' | 'extend' | 'void'
  ) => {
    setSelectedMarket(market);
    setActionType(action);
    setResolution(true);
    setExtendDate('');
    setActionReason('');
    setShowActionModal(true);
  };

  const executeAction = () => {
    if (!selectedMarket) return;

    startActioning(async () => {
      // Validate extend date early
      if (actionType === 'extend' && !extendDate) {
        toast.error('Please select a new end date');
        return;
      }

      // datetime-local yields a timezone-less local wall-clock value; convert
      // it explicitly to an absolute ISO instant before sending.
      const newEndDate =
        actionType === 'extend'
          ? new Date(extendDate).toISOString()
          : undefined;

      const body: MarketActionBody = {
        action: actionType,
        reason: actionReason || undefined,
        ...(actionType === 'resolve' && { resolution }),
        ...(newEndDate && { newEndDate }),
      };

      let response: Response;
      try {
        response = await fetch(
          apiUrl(`/api/admin/markets/${selectedMarket.id}`),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to perform action'
        );
        return;
      }

      if (!response.ok) {
        toast.error(
          parseErrorText(await response.text()) || 'Failed to perform action'
        );
        return;
      }

      setShowActionModal(false);
      setSelectedMarket(null);
      fetchMarkets(true);
    });
  };

  /** Use shared formatCompactCurrency for currency formatting */
  const formatCurrency = formatCompactCurrency;

  const getStatusBadge = (status: Market['status']) => {
    switch (status) {
      case 'active':
        return (
          <span className="flex items-center gap-1 rounded bg-green-500/20 px-2 py-1 font-medium text-green-500 text-xs">
            <Check className="h-3 w-3" /> Active
          </span>
        );
      case 'expired':
        return (
          <span className="flex items-center gap-1 rounded bg-yellow-500/20 px-2 py-1 font-medium text-xs text-yellow-500">
            <Clock className="h-3 w-3" /> Expired
          </span>
        );
      case 'resolved':
        return (
          <span className="flex items-center gap-1 rounded bg-blue-500/20 px-2 py-1 font-medium text-blue-500 text-xs">
            <Check className="h-3 w-3" /> Resolved
          </span>
        );
    }
  };

  const MarketCard = ({ market }: { market: Market }) => (
    <div className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md sm:p-5">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2 sm:mb-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 font-medium text-sm sm:text-base">
            {market.question}
          </h4>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground sm:gap-2 sm:text-xs">
            <Calendar className="h-3 w-3 flex-shrink-0" />
            Ends {formatDate(market.endDate)}
          </div>
        </div>
        {getStatusBadge(market.status)}
      </div>

      {/* Price Bar */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-green-500">YES {market.yesPrice}%</span>
          <span className="text-red-500">NO {market.noPrice}%</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${market.yesPrice}%` }}
          />
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${market.noPrice}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="mb-3 grid grid-cols-3 gap-2 sm:mb-4 sm:gap-4">
        <div className="rounded-lg bg-muted/50 p-1.5 text-center sm:p-2">
          <div className="font-semibold text-sm sm:text-base">
            {market.positionCount}
          </div>
          <div className="text-[10px] text-muted-foreground sm:text-xs">
            Positions
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-1.5 text-center sm:p-2">
          <div className="font-semibold text-sm sm:text-base">
            {market.tradeCount}
          </div>
          <div className="text-[10px] text-muted-foreground sm:text-xs">
            Trades
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-1.5 text-center sm:p-2">
          <div className="font-semibold text-sm sm:text-base">
            {formatCurrency(market.totalVolume)}
          </div>
          <div className="text-[10px] text-muted-foreground sm:text-xs">
            Volume
          </div>
        </div>
      </div>

      {/* Resolution Result */}
      {market.resolved && market.resolution !== null && (
        <div className="mb-4 rounded-lg bg-blue-500/10 p-3 text-center">
          <span className="font-medium">
            Resolved: {market.resolution ? 'YES ✓' : 'NO ✗'}
          </span>
        </div>
      )}

      {/* Actions */}
      {!market.resolved && (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
          <button
            onClick={() => handleAction(market, 'resolve')}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-500/20 px-2.5 py-1.5 font-medium text-blue-500 text-xs transition-colors hover:bg-blue-500/30 sm:px-3 sm:py-2 sm:text-sm"
          >
            <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Resolve
          </button>
          <button
            onClick={() => handleAction(market, 'extend')}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-purple-500/20 px-2.5 py-1.5 font-medium text-purple-500 text-xs transition-colors hover:bg-purple-500/30 sm:px-3 sm:py-2 sm:text-sm"
          >
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Extend
          </button>
          <button
            onClick={() => handleAction(market, 'void')}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-500/20 px-2.5 py-1.5 font-medium text-red-500 text-xs transition-colors hover:bg-red-500/30 sm:px-3 sm:py-2 sm:text-sm"
          >
            <XCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Void
          </button>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 sm:h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-56 sm:h-64" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <BarChart2 className="mx-auto mb-3 h-12 w-12 opacity-50" />
        <p>Failed to load market data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-2xl">
            <TrendingUp className="h-6 w-6 text-green-500" />
            Market Oversight
          </h2>
          <p className="mt-1 text-muted-foreground">
            Manage prediction markets
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Status Filter */}
          <div className="flex overflow-x-auto rounded-lg border border-border bg-card">
            {(['all', 'active', 'expired', 'resolved'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statusFilter === s}
                onClick={() => {
                  if (s === statusFilter) return;
                  setStatusFilter(s);
                  setLoading(true);
                }}
                className={cn(
                  'whitespace-nowrap px-2 py-1.5 font-medium text-xs transition-colors first:rounded-l-lg last:rounded-r-lg sm:px-3 sm:py-2 sm:text-sm',
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          <button
            onClick={() => fetchMarkets(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-muted/80 disabled:opacity-50 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5 sm:h-4 sm:w-4',
                isRefreshing && 'animate-spin'
              )}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3 sm:p-5">
          <div className="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
            <BarChart2 className="h-4 w-4 text-blue-500 sm:h-5 sm:w-5" />
            <span className="text-muted-foreground text-xs sm:text-sm">
              Total Markets
            </span>
          </div>
          <div className="font-bold text-xl sm:text-2xl">
            {data.stats.total}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-5">
          <div className="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
            <Check className="h-4 w-4 text-green-500 sm:h-5 sm:w-5" />
            <span className="text-muted-foreground text-xs sm:text-sm">
              Active
            </span>
          </div>
          <div className="font-bold text-green-500 text-xl sm:text-2xl">
            {data.stats.active}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-5">
          <div className="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 sm:h-5 sm:w-5" />
            <span className="truncate text-muted-foreground text-xs sm:text-sm">
              Needs Resolution
            </span>
          </div>
          <div className="font-bold text-xl text-yellow-500 sm:text-2xl">
            {data.stats.expired}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-5">
          <div className="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
            <DollarSign className="h-4 w-4 text-purple-500 sm:h-5 sm:w-5" />
            <span className="text-muted-foreground text-xs sm:text-sm">
              Total Liquidity
            </span>
          </div>
          <div className="font-bold text-xl sm:text-2xl">
            {formatCurrency(data.stats.totalLiquidity)}
          </div>
        </div>
      </div>

      {/* Expired Warning */}
      {data.stats.expired > 0 && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-yellow-500">
            <AlertTriangle className="h-5 w-5" />
            {data.stats.expired} market{data.stats.expired > 1 ? 's' : ''} need
            {data.stats.expired === 1 ? 's' : ''} resolution
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            These markets have passed their end date and require admin action.
          </p>
        </div>
      )}

      {/* Markets Grid */}
      {data.markets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-8 text-center sm:py-12">
          <BarChart2 className="mx-auto mb-3 h-10 w-10 opacity-50 sm:h-12 sm:w-12" />
          <p className="text-muted-foreground text-sm sm:text-base">
            No markets found
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.markets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}

      {/* Action Modal */}
      {showActionModal && selectedMarket && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6">
            <h3 className="mb-4 font-bold text-xl">
              {actionType === 'resolve'
                ? 'Resolve Market'
                : actionType === 'extend'
                  ? 'Extend Market'
                  : 'Void Market'}
            </h3>

            <div className="mb-4 rounded-lg bg-muted/50 p-3">
              <p className="line-clamp-2 font-medium">
                {selectedMarket.question}
              </p>
            </div>

            {actionType === 'resolve' && (
              <div className="mb-4">
                <label className="mb-2 block font-medium text-sm">
                  Resolution
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setResolution(true)}
                    className={cn(
                      'flex-1 rounded-lg border-2 p-4 text-center transition-colors',
                      resolution
                        ? 'border-green-500 bg-green-500/20 text-green-500'
                        : 'border-border hover:border-green-500/50'
                    )}
                  >
                    <Check className="mx-auto mb-1 h-6 w-6" />
                    YES
                  </button>
                  <button
                    onClick={() => setResolution(false)}
                    className={cn(
                      'flex-1 rounded-lg border-2 p-4 text-center transition-colors',
                      !resolution
                        ? 'border-red-500 bg-red-500/20 text-red-500'
                        : 'border-border hover:border-red-500/50'
                    )}
                  >
                    <X className="mx-auto mb-1 h-6 w-6" />
                    NO
                  </button>
                </div>
              </div>
            )}

            {actionType === 'extend' && (
              <div className="mb-4">
                <label className="mb-2 block font-medium text-sm">
                  New End Date (
                  {Intl.DateTimeFormat().resolvedOptions().timeZone})
                </label>
                <input
                  type="datetime-local"
                  value={extendDate}
                  onChange={(e) => setExtendDate(e.target.value)}
                  min={toLocalDateTimeInputValue(new Date())}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </div>
            )}

            {actionType === 'void' && (
              <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-red-500">
                <AlertTriangle className="mb-1 h-5 w-5" />
                <p className="text-sm">
                  Voiding a market will refund all positions. This action cannot
                  be undone.
                </p>
              </div>
            )}

            <div className="mb-4">
              <label className="mb-2 block font-medium text-sm">
                Reason {actionType !== 'extend' && '(optional)'}
              </label>
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Enter reason..."
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2"
                rows={2}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowActionModal(false)}
                disabled={isActioning}
                className="flex-1 rounded-lg bg-muted px-4 py-2 font-medium transition-colors hover:bg-muted/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={executeAction}
                disabled={isActioning}
                className={cn(
                  'flex-1 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-50',
                  actionType === 'resolve'
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : actionType === 'extend'
                      ? 'bg-purple-500 text-white hover:bg-purple-600'
                      : 'bg-red-500 text-white hover:bg-red-600'
                )}
              >
                {isActioning ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
