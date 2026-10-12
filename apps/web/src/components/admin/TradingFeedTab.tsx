'use client';

import { cn, formatCompactCurrency, formatRelativeTime } from '@feed/shared';
import { Activity, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Avatar } from '@/components/shared/Avatar';
import { Skeleton } from '@/components/shared/Skeleton';
import { apiUrl } from '@/utils/api-url';

/**
 * Trade type schema for validation.
 */
const TradeTypeSchema = z.enum(['balance', 'npc', 'position']);
type TradeType = z.infer<typeof TradeTypeSchema>;

/**
 * User schema for validation.
 */
const UserSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  isActor: z.boolean(),
});

/**
 * Base trade schema for validation.
 */
const BaseTradeSchema = z.object({
  type: TradeTypeSchema,
  id: z.string(),
  timestamp: z.coerce.date(),
  user: UserSchema.nullable(),
});

/**
 * Balance trade schema for validation.
 */
const BalanceTradeSchema = BaseTradeSchema.extend({
  type: z.literal('balance'),
  amount: z.string(),
  balanceBefore: z.string(),
  balanceAfter: z.string(),
  transactionType: z.string(),
  description: z.string().nullable(),
  relatedId: z.string().nullable(),
});
type BalanceTrade = z.infer<typeof BalanceTradeSchema>;

/**
 * NPC trade schema for validation.
 */
const NPCTradeSchema = BaseTradeSchema.extend({
  type: z.literal('npc'),
  marketType: z.string(),
  ticker: z.string().nullable(),
  marketId: z.string().nullable(),
  action: z.string(),
  side: z.string().nullable(),
  amount: z.number(),
  price: z.number(),
  sentiment: z.number().nullable(),
  reason: z.string().nullable(),
});
type NPCTrade = z.infer<typeof NPCTradeSchema>;

/**
 * Position trade schema for validation.
 */
const PositionTradeSchema = BaseTradeSchema.extend({
  type: z.literal('position'),
  market: z
    .object({
      id: z.string(),
      question: z.string(),
      resolved: z.boolean(),
      resolution: z.boolean().nullable(),
    })
    .nullable(),
  side: z.string(),
  shares: z.string(),
  avgPrice: z.string(),
  createdAt: z.coerce.date(),
});
type PositionTrade = z.infer<typeof PositionTradeSchema>;

/**
 * Trade schema union for validation.
 */
const TradeSchema = z.discriminatedUnion('type', [
  BalanceTradeSchema,
  NPCTradeSchema,
  PositionTradeSchema,
]);
type Trade = z.infer<typeof TradeSchema>;

const PAGE_SIZE = 50;
/** Mirrors the server-side offset cap in /api/admin/trades. */
const MAX_OFFSET = 1000;

const TradesResponseSchema = z.object({
  trades: z.array(TradeSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
    hasMore: z.boolean(),
  }),
});

type TradeFilter = 'all' | TradeType;

const FILTER_LABELS: Record<TradeFilter, string> = {
  all: 'All',
  balance: 'Balance',
  npc: 'NPC',
  position: 'Position',
};

/**
 * Format a money value for display. Values that fail to parse are shown
 * verbatim rather than masked as zero.
 */
function formatMoney(value: string | number): string {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? formatCompactCurrency(num) : String(value);
}

function BalanceTradeDetails({ trade }: { trade: BalanceTrade }) {
  const amount = Number(trade.amount);
  const isPositive = Number.isFinite(amount) && amount >= 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded px-2 py-1 font-medium text-xs',
            isPositive
              ? 'bg-green-500/20 text-green-500'
              : 'bg-red-500/20 text-red-500'
          )}
        >
          {trade.transactionType}
        </span>
        <span
          className={cn(
            'font-bold text-lg',
            isPositive ? 'text-green-600' : 'text-red-600'
          )}
        >
          {isPositive ? '+' : ''}
          {formatMoney(trade.amount)}
        </span>
      </div>
      {trade.description && (
        <p className="text-muted-foreground text-sm">{trade.description}</p>
      )}
      <div className="text-muted-foreground text-xs">
        Balance: {formatMoney(trade.balanceBefore)} →{' '}
        {formatMoney(trade.balanceAfter)}
      </div>
    </div>
  );
}

function NPCTradeDetails({ trade }: { trade: NPCTrade }) {
  const side = trade.side?.toLowerCase();
  const sideClass =
    side === 'long' || side === 'yes'
      ? 'text-green-600'
      : side === 'short' || side === 'no'
        ? 'text-red-600'
        : 'text-muted-foreground';

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-2 py-1 font-medium text-xs">
          {trade.action.toUpperCase()}
        </span>
        {trade.ticker && <span className="font-bold">{trade.ticker}</span>}
        {trade.side && (
          <span className={cn('font-medium text-xs', sideClass)}>
            {trade.side}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span>Amount: {formatMoney(trade.amount)}</span>
        <span>Price: {formatMoney(trade.price)}</span>
        {trade.sentiment !== null && (
          <span
            className={cn(
              'text-xs',
              trade.sentiment > 0
                ? 'text-green-600'
                : trade.sentiment < 0
                  ? 'text-red-600'
                  : 'text-gray-600'
            )}
          >
            Sentiment: {trade.sentiment > 0 ? '+' : ''}
            {(trade.sentiment * 100).toFixed(0)}%
          </span>
        )}
      </div>
      {trade.reason && (
        <p className="text-muted-foreground text-xs italic">
          &quot;{trade.reason}&quot;
        </p>
      )}
    </div>
  );
}

function PositionTradeDetails({ trade }: { trade: PositionTrade }) {
  const isYes = trade.side === 'YES';
  const shares = Number(trade.shares);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'rounded px-2 py-1 font-medium text-xs',
            isYes
              ? 'bg-green-500/20 text-green-500'
              : 'bg-red-500/20 text-red-500'
          )}
        >
          {trade.side}
        </span>
        <span className="text-muted-foreground text-xs">
          Current position snapshot
        </span>
      </div>
      <p className="font-medium text-sm">
        {trade.market?.question ?? 'Unknown market (deleted or missing)'}
      </p>
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        <span>
          Shares: {Number.isFinite(shares) ? shares.toFixed(2) : trade.shares}
        </span>
        <span>Avg Price: {formatMoney(trade.avgPrice)}</span>
      </div>
      {trade.market?.resolved && (
        <div className="text-xs">
          <span className="text-muted-foreground">Resolved: </span>
          <span
            className={cn(
              'font-medium',
              trade.market.resolution === true
                ? 'text-green-600'
                : trade.market.resolution === false
                  ? 'text-red-600'
                  : 'text-muted-foreground'
            )}
          >
            {trade.market.resolution === true
              ? 'YES'
              : trade.market.resolution === false
                ? 'NO'
                : 'No outcome (void/unknown)'}
          </span>
        </div>
      )}
    </div>
  );
}

function TradeCard({ trade }: { trade: Trade }) {
  const displayName = trade.user
    ? trade.user.displayName || trade.user.username || trade.user.id
    : 'Unknown user (deleted or missing)';

  return (
    <div className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/50">
      <div className="flex items-start gap-3">
        <Avatar
          src={trade.user?.profileImageUrl || undefined}
          alt={displayName}
          size="sm"
        />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={cn(
                'truncate font-medium',
                !trade.user && 'text-muted-foreground italic'
              )}
            >
              {displayName}
            </span>
            {trade.user?.isActor && (
              <span className="rounded bg-purple-500/20 px-2 py-0.5 text-purple-500 text-xs">
                NPC
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              {formatRelativeTime(trade.timestamp)}
            </span>
          </div>

          {trade.type === 'balance' && <BalanceTradeDetails trade={trade} />}
          {trade.type === 'npc' && <NPCTradeDetails trade={trade} />}
          {trade.type === 'position' && <PositionTradeDetails trade={trade} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Read-only trading feed for admins.
 *
 * Lists balance transactions, NPC trades and position snapshots with type
 * filtering, pagination and a 10s auto-refresh of the current page.
 *
 * @returns Trading feed tab element
 */
export function TradingFeedTab() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [filter, setFilter] = useState<TradeFilter>('all');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // Monotonic request id: only the latest request may update state, so a
  // slow response for an old filter/page cannot overwrite newer results.
  const latestRequest = useRef(0);

  const fetchTrades = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setIsFetching(true);
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (filter !== 'all') query.set('type', filter);

    let nextError: string | null = null;
    try {
      const response = await fetch(apiUrl(`/api/admin/trades?${query}`));
      if (!response.ok) {
        nextError = `Failed to load trades (HTTP ${response.status})`;
      } else {
        const parsed = TradesResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          nextError = 'Unexpected trade feed response shape';
        } else if (requestId === latestRequest.current) {
          setTrades(parsed.data.trades);
          setTotal(parsed.data.pagination.total);
          setHasMore(parsed.data.pagination.hasMore);
          setHasLoaded(true);
        }
      }
    } catch (err) {
      nextError = err instanceof Error ? err.message : 'Failed to load trades';
    }

    if (requestId === latestRequest.current) {
      setError(nextError);
      setIsFetching(false);
    }
  }, [filter, offset]);

  useEffect(() => {
    void fetchTrades();
    const interval = setInterval(() => void fetchTrades(), 10000);
    return () => clearInterval(interval);
  }, [fetchTrades]);

  const selectFilter = (next: TradeFilter) => {
    setFilter(next);
    setOffset(0);
  };

  if (!hasLoaded && !error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="w-full space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FILTER_LABELS) as TradeFilter[]).map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => selectFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                'rounded px-3 py-1.5 font-medium text-sm transition-colors',
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void fetchTrades()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded bg-muted px-3 py-1.5 font-medium text-sm transition-colors hover:bg-muted/80 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-500/10 p-3 text-red-500 text-sm">
          {error}
          {hasLoaded && ' — showing previously loaded results.'}
        </div>
      )}

      {hasLoaded && trades.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <Activity className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p>No trades found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {trades.map((trade) => (
            <TradeCard key={`${trade.type}:${trade.id}`} trade={trade} />
          ))}
        </div>
      )}

      {hasLoaded && (offset > 0 || hasMore) && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0 || isFetching}
            className="rounded bg-muted px-3 py-1.5 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            {offset + 1}–{offset + trades.length} of {total}
          </span>
          <button
            type="button"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={!hasMore || isFetching || offset + PAGE_SIZE > MAX_OFFSET}
            className="rounded bg-muted px-3 py-1.5 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
