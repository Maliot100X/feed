'use client';

export const dynamic = 'force-dynamic';

import nextDynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageContainer } from '@/components/shared/PageContainer';
import { PositionsTab } from '@/components/wallet/v2/positions-tab';
import { useAuth } from '@/hooks/useAuth';
import { useUserPositionsPolling } from '@/stores/userPositionsStore';
import { invalidateWalletBalance } from '@/stores/walletBalanceStore';
import { MarketsTradingTerminal } from './_components/terminal/MarketsTradingTerminal';

const BuyPointsModal = nextDynamic(
  () =>
    import('@/components/points/BuyPointsModal').then((m) => ({
      default: m.BuyPointsModal,
    })),
  { ssr: false }
);

/**
 * Markets route (`/markets`): page shell (layout, Stripe return handling, buy points modal).
 *
 * The full trading terminal UI — market list, charts, order entry, filters — is implemented
 * in `./_components/terminal/MarketsTradingTerminal.tsx`, not in this file.
 */
export default function MarketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, user } = useAuth();
  const userId = authenticated ? user?.id : undefined;
  const [showBuyPointsModal, setShowBuyPointsModal] = useState(false);

  // Poll positions for the sidebar
  useUserPositionsPolling(userId ?? null);

  // Guards against re-handling the same Stripe return while router.replace
  // is in flight; reset once the params are gone so a later checkout in the
  // same mounted page is handled too.
  const stripeHandledRef = useRef(false);
  // Follow-up balance refresh must survive the URL cleanup (which changes
  // searchParams and re-runs the effect), so it is only cleared on unmount.
  const stripeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(
    () => () => {
      if (stripeRefreshTimerRef.current) {
        clearTimeout(stripeRefreshTimerRef.current);
      }
    },
    []
  );

  // Handle Stripe Checkout success/cancel redirects: notify, refresh the
  // balance and clean the URL. The query string only indicates a return from
  // Checkout; points are credited by the webhook.
  useEffect(() => {
    const stripeSuccess = searchParams.get('stripe_success') === 'true';
    const stripeCancelled = searchParams.get('stripe_cancelled') === 'true';

    if (!stripeSuccess && !stripeCancelled) {
      stripeHandledRef.current = false;
      return;
    }
    if (stripeHandledRef.current) return;
    stripeHandledRef.current = true;

    invalidateWalletBalance();
    const url = new URL(window.location.href);

    if (stripeSuccess) {
      toast.success('Checkout complete', {
        duration: 5000,
        description:
          'Your points will be credited once the payment is confirmed. Your balance will update automatically.',
      });
      // The webhook credits points asynchronously; refresh once more after it
      // has typically landed.
      if (stripeRefreshTimerRef.current) {
        clearTimeout(stripeRefreshTimerRef.current);
      }
      stripeRefreshTimerRef.current = setTimeout(() => {
        stripeRefreshTimerRef.current = null;
        invalidateWalletBalance();
      }, 3000);
      url.searchParams.delete('stripe_success');
      url.searchParams.delete('session_id');
    } else {
      url.searchParams.delete('stripe_cancelled');
    }

    router.replace(url.pathname + url.search, { scroll: false });
  }, [searchParams, router]);

  return (
    <PageContainer
      noPadding
      className="mt-14 flex h-[calc(100dvh-56px-var(--bottom-nav-height))] min-h-0 flex-col overflow-hidden md:mt-0 md:h-dvh"
    >
      <div className="relative flex flex-1 overflow-hidden">
        {/* Main trading terminal */}
        <div className="flex min-w-0 flex-1 flex-col border-border bg-background/20 lg:border-l">
          <MarketsTradingTerminal
            onRequestBuyPoints={() => setShowBuyPointsModal(true)}
          />
        </div>

        {/* Right sidebar — Positions (same as wallet page) */}
        {ready && authenticated && userId && (
          <div className="hidden w-96 flex-none flex-col overflow-y-auto border-border border-l xl:flex">
            <div className="p-4">
              <PositionsTab userId={userId} />
            </div>
          </div>
        )}
      </div>

      {showBuyPointsModal && (
        <BuyPointsModal
          isOpen={showBuyPointsModal}
          onClose={() => setShowBuyPointsModal(false)}
        />
      )}
    </PageContainer>
  );
}
