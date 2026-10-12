'use client';

import { getReferralUrl } from '@feed/shared';
import { Check, Copy, ExternalLink, Trophy, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiFetch } from '@/utils/api-fetch';
import { readStorageItem, writeStorageItem } from '@/utils/browser-storage';

/**
 * Invite friends banner component for referral program.
 *
 * Displays a banner encouraging users to invite friends and earn referral
 * rewards. Shows referral code, copy functionality, and tracks banner views
 * and dismissals. Links to rewards page for more details.
 *
 * @param props - InviteFriendsBanner component props
 * @returns Invite friends banner element or null if no referral code
 *
 * @example
 * ```tsx
 * <InviteFriendsBanner onDismiss={() => console.log('dismissed')} />
 * ```
 */
interface InviteFriendsBannerProps {
  onDismiss?: () => void;
}

export function InviteFriendsBanner({ onDismiss }: InviteFriendsBannerProps) {
  const { user, setUser } = useAuthStore();
  const [copiedReferral, setCopiedReferral] = useState(false);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const viewKey = `banner_view_${userId}`;

    const trackBannerView = async () => {
      const lastView = Number(readStorageItem('localStorage', viewKey) ?? 0);
      const now = Date.now();
      // Server tracking at most once per day. Only a *successful* report
      // updates the timestamp — writing it on every render kept pushing it
      // forward and suppressed server tracking indefinitely.
      if (lastView && now - lastView <= 86_400_000) return;

      const response = await apiFetch(
        `/api/users/${encodeURIComponent(userId)}/update-profile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bannerLastShown: new Date(now).toISOString(),
          }),
          signal: controller.signal,
        }
      );
      if (response.ok) writeStorageItem('localStorage', viewKey, String(now));
    };

    void trackBannerView().catch(() => {
      // Best-effort telemetry: retried on a later visit.
    });
    return () => controller.abort();
  }, [userId]);

  const handleCopyReferral = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!user?.referralCode) return;
    const referralUrl = getReferralUrl(user.referralCode);
    await navigator.clipboard.writeText(referralUrl);
    setCopiedReferral(true);
    setTimeout(() => setCopiedReferral(false), 2000);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!userId) return;

    // Close immediately; reporting the dismissal must not block the UI.
    onDismiss?.();

    const dismissKey = `banner_dismiss_${userId}`;
    const dismissCount =
      Number(readStorageItem('localStorage', dismissKey) ?? 0) + 1;
    writeStorageItem('localStorage', dismissKey, String(dismissCount));
    writeStorageItem(
      'localStorage',
      `banner_dismiss_time_${userId}`,
      Date.now().toString()
    );

    void apiFetch(`/api/users/${encodeURIComponent(userId)}/update-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bannerDismissCount: dismissCount }),
    })
      .then((response) => {
        if (!response.ok) return;
        // Patch the *current* user only if it is still the same account.
        const current = useAuthStore.getState().user;
        if (current?.id === userId) {
          setUser({ ...current, bannerDismissCount: dismissCount });
        }
      })
      .catch(() => {
        // Best-effort: the local dismissal already took effect.
      });
  };

  if (!user?.referralCode) {
    return null;
  }

  return (
    <Link
      href="/rewards"
      className="group block border-border border-b transition-colors hover:bg-muted/30"
    >
      <div className="mx-auto max-w-feed p-4">
        <div className="relative rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-pink-500/10 p-4 transition-colors hover:border-purple-500/40">
          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 rounded-full p-1 opacity-0 transition-colors hover:bg-background/50 group-hover:opacity-100"
            title="Dismiss"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>

          <div className="mb-2 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-purple-500" />
            <h3 className="font-semibold text-foreground">Invite Friends</h3>
            <span className="ml-auto rounded bg-green-500/10 px-2 py-1 text-green-500 text-xs">
              50% of fees
            </span>
          </div>
          <p className="mb-3 text-muted-foreground text-sm">
            Earn 50% of all trading fees from your referrals!
          </p>
          <div className="flex items-center justify-between">
            <button
              onClick={handleCopyReferral}
              className="flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-foreground transition-colors hover:bg-sidebar-accent/70"
            >
              {copiedReferral ? (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span className="text-sm">Copy Link</span>
                </>
              )}
            </button>
            <span className="flex items-center gap-1 text-purple-500 text-sm group-hover:text-purple-400">
              View All
              <ExternalLink className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
