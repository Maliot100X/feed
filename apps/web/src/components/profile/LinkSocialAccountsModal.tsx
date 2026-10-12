'use client';

import { cn } from '@feed/shared';
import { Check, ExternalLink, Mail, Shield, X as XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTelegramMiniApp } from '@/components/providers/TelegramMiniAppProvider';
import { getAuthToken } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';
import { apiUrl } from '@/utils/api-url';

/**
 * Link social accounts modal component for connecting social accounts.
 *
 * Provides a modal interface for linking email, Twitter
 * accounts. Handles account-link callbacks and updates user profile with
 * linked account information. Awards reputation points for social linking.
 *
 * Features:
 * - Shows the account email (verified only when the server says so)
 * - Twitter OAuth linking
 * - OAuth callback handling
 * - Points/reputation awards
 * - Loading states
 * - Error handling
 * - Body scroll lock and escape key handling
 *
 * @param props - LinkSocialAccountsModal component props
 * @returns Link social accounts modal element or null if not open
 *
 * @example
 * ```tsx
 * <LinkSocialAccountsModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 * />
 * ```
 */
interface LinkSocialAccountsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LinkSocialAccountsModal({
  isOpen,
  onClose,
}: LinkSocialAccountsModalProps) {
  const { user, setUser } = useAuthStore();
  const { isMiniApp, linkAccount: linkTelegramSeamless } = useTelegramMiniApp();
  const [linking, setLinking] = useState<string | null>(null);
  const [confirmUnlinkTwitter, setConfirmUnlinkTwitter] = useState(false);
  const [unlinkingTwitter, setUnlinkingTwitter] = useState(false);

  // Email comes from the Feed user record (set by Steward at login). Only
  // show it as verified when the server says so.
  const accountEmail = user?.email ?? null;
  const isEmailVerified = Boolean(accountEmail && user?.emailVerified);

  useEffect(() => {
    if (isOpen) return;
    setLinking(null);
    setConfirmUnlinkTwitter(false);
    setUnlinkingTwitter(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTwitterOAuth = async () => {
    if (!user?.id) return;

    setLinking('twitter');

    sessionStorage.setItem('oauth_return_url', window.location.pathname);
    window.location.href = `/api/auth/twitter/initiate`;
  };

  const handleTwitterDisconnect = async () => {
    if (!user?.id) return;

    const token = getAuthToken();
    if (!token) {
      toast.error('Please sign in again to unlink X');
      return;
    }

    setUnlinkingTwitter(true);
    try {
      const response = await fetch(apiUrl('/api/twitter/disconnect'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;

      if (!response.ok || !data?.success) {
        toast.error(data?.error || 'Failed to unlink X account');
        return;
      }

      setUser({
        ...user,
        hasTwitter: false,
        twitterUsername: undefined,
      });
      setConfirmUnlinkTwitter(false);
      toast.success('X account unlinked');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setUnlinkingTwitter(false);
    }
  };

  const handleTelegramLink = () => {
    if (!user?.id) return;
    setLinking('telegram');

    if (isMiniApp) {
      // Inside Telegram MiniApp — use captured initData for seamless linking.
      // Success/error handled by useLinkAccount onSuccess/onError callbacks.
      const started = linkTelegramSeamless();
      if (!started) {
        setLinking(null);
        toast.error('Unable to link Telegram. Please try again.');
      }
    } else {
      // Phase 2: Telegram linking outside mini-app — not yet implemented
      setLinking(null);
      toast.info('Open Feed in Telegram to link your Telegram account.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm md:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col bg-background md:h-auto md:max-h-[90vh] md:w-auto md:min-w-[480px] md:max-w-md md:rounded-xl md:border md:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-border border-b p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-xl">Link Accounts</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover:bg-muted"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          {/* Email */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              <h3 className="font-semibold">Email</h3>
              {accountEmail && (
                <span
                  className={cn(
                    'ml-auto flex items-center gap-1 text-sm',
                    isEmailVerified ? 'text-green-500' : 'text-muted-foreground'
                  )}
                >
                  {isEmailVerified && <Check className="h-4 w-4" />}
                  {isEmailVerified ? 'Verified' : 'Unverified'}
                </span>
              )}
            </div>

            {accountEmail ? (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-3',
                  isEmailVerified
                    ? 'border-green-500/20 bg-green-500/10'
                    : 'border-border bg-muted/30'
                )}
              >
                {isEmailVerified && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
                <span className="font-medium text-sm">{accountEmail}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <p className="text-muted-foreground text-xs">
                  Sign in with your email to attach it to your account and
                  enable notification emails.
                </p>
              </div>
            )}
          </div>

          {/* Twitter/X */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <h3 className="font-semibold">X</h3>
              {user?.hasTwitter && (
                <span className="ml-auto flex items-center gap-1 text-green-500 text-sm">
                  <Check className="h-4 w-4" />
                  Verified
                </span>
              )}
            </div>

            {user?.hasTwitter ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="font-medium text-sm">
                    {user.twitterUsername
                      ? `@${user.twitterUsername}`
                      : 'Connected'}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {user.twitterUsername && (
                      <a
                        href={`https://x.com/${user.twitterUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80"
                        title="Open X profile"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmUnlinkTwitter((v) => !v)}
                      className="rounded px-2 py-1 font-medium text-red-600 text-xs hover:bg-red-500/10"
                    >
                      Unlink
                    </button>
                  </div>
                </div>

                {confirmUnlinkTwitter && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <p className="text-muted-foreground text-xs">
                      This disconnects your X account from Feed. You can
                      reconnect a different X account afterwards.
                    </p>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmUnlinkTwitter(false)}
                        disabled={unlinkingTwitter}
                        className="rounded px-3 py-1.5 font-medium text-xs hover:bg-muted"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTwitterDisconnect()}
                        disabled={unlinkingTwitter}
                        className={cn(
                          'rounded px-3 py-1.5 font-semibold text-xs',
                          'bg-red-600 text-white hover:bg-red-600/90',
                          'disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      >
                        {unlinkingTwitter ? 'Unlinking...' : 'Confirm unlink'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <p className="text-muted-foreground text-xs">
                    You&apos;ll be redirected to X to authorize access.
                    We&apos;ll verify your account ownership.
                  </p>
                </div>
                <button
                  onClick={handleTwitterOAuth}
                  disabled={linking === 'twitter'}
                  className={cn(
                    'w-full rounded-lg px-4 py-2 font-semibold transition-colors',
                    'bg-[#0066FF] text-primary-foreground hover:bg-[#2952d9]',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    'flex items-center justify-center gap-2'
                  )}
                >
                  {linking === 'twitter' ? (
                    <>
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4" />
                      <span>Connect with X</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Telegram */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
              <h3 className="font-semibold">Telegram</h3>
              {user?.hasTelegram && (
                <span className="ml-auto flex items-center gap-1 text-green-500 text-sm">
                  <Check className="h-4 w-4" />
                  Verified
                </span>
              )}
            </div>

            {user?.hasTelegram ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3">
                <Check className="h-4 w-4 text-green-500" />
                <span className="font-medium text-sm">
                  {user.telegramUsername
                    ? `@${user.telegramUsername}`
                    : 'Connected'}
                </span>
                {user.telegramUsername && (
                  <a
                    href={`https://t.me/${user.telegramUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-primary hover:text-primary/80"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                  <p className="text-muted-foreground text-xs">
                    {isMiniApp
                      ? 'Link your Telegram account to earn points and unlock rewards.'
                      : 'Open Feed in Telegram to seamlessly link your account.'}
                  </p>
                </div>
                <button
                  onClick={handleTelegramLink}
                  disabled={linking === 'telegram'}
                  className={cn(
                    'w-full rounded-lg px-4 py-2 font-semibold transition-colors',
                    'bg-[#229ED9] text-white hover:bg-[#1d8abf]',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    'flex items-center justify-center gap-2'
                  )}
                >
                  {linking === 'telegram' ? (
                    <span>Connecting...</span>
                  ) : (
                    <>
                      <Shield className="h-4 w-4" />
                      <span>Link Telegram</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-muted-foreground text-sm">
                Account linking verifies ownership and can unlock features like
                notifications and reputation rewards.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-border border-t p-6">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-muted px-4 py-3 font-semibold transition-colors hover:bg-muted/70"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
