'use client';

import { cn } from '@feed/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

/* ─── Shared ─────────────────────────────────────────────── */

interface SignalCardShellProps {
  accent: 'green' | 'red';
  href: string;
  children: React.ReactNode;
}

const accentHover = {
  green: 'hover:bg-green-500/5',
  red: 'hover:bg-red-500/5',
} as const;

/** Consistent shell for all feed signal cards — entire card is tappable */
function SignalCardShell({ accent, href, children }: SignalCardShellProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center justify-between gap-3 border-border border-b px-4 py-3 transition-colors',
        accentHover[accent]
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ─── 4b. Top Gainer of the Day Card ─────────────────────── */

export interface TopGainerProps {
  marketId: string;
  marketName: string;
  pointsGained: number;
  gainPercent: number;
  agentName?: string;
}

export function TopGainerCard({
  marketId,
  marketName,
  pointsGained,
  gainPercent,
  agentName,
}: TopGainerProps) {
  return (
    <SignalCardShell
      accent="green"
      href={`/markets/predictions/${encodeURIComponent(marketId)}`}
    >
      <p className="font-semibold text-foreground text-sm leading-snug">
        {marketName}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="font-bold text-green-500 text-sm">
          +{pointsGained.toLocaleString('en-US')} pts
        </span>
        <span className="font-medium text-green-500 text-xs">
          +{gainPercent.toFixed(1)}%
        </span>
        {agentName && (
          <span className="text-muted-foreground text-xs">
            via <span className="font-medium text-foreground">{agentName}</span>
          </span>
        )}
      </div>
    </SignalCardShell>
  );
}

/* ─── 4c. Top Loser of the Day Card ──────────────────────── */

export interface TopLoserProps {
  marketId: string;
  marketName: string;
  pointsLost: number;
  lossPercent: number;
  agentName?: string;
}

export function TopLoserCard({
  marketId,
  marketName,
  pointsLost,
  lossPercent,
  agentName,
}: TopLoserProps) {
  return (
    <SignalCardShell
      accent="red"
      href={`/markets/predictions/${encodeURIComponent(marketId)}`}
    >
      <p className="font-semibold text-foreground text-sm leading-snug">
        {marketName}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="font-bold text-red-500 text-sm">
          {pointsLost.toLocaleString('en-US')} pts
        </span>
        <span className="font-medium text-red-500 text-xs">
          {lossPercent.toFixed(1)}%
        </span>
        {agentName && (
          <span className="text-muted-foreground text-xs">
            via <span className="font-medium text-foreground">{agentName}</span>
          </span>
        )}
      </div>
    </SignalCardShell>
  );
}
