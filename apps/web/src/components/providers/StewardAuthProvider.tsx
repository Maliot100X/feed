'use client';

import type { StewardSession } from '@stwd/sdk';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getBrowserDevAuthSession } from '@/lib/auth/dev-auth';
import { FeedStewardAuth } from '@/lib/auth/feed-steward-auth';
import { createSessionCookieSync } from '@/lib/auth/session-cookie-sync';
import { getStewardApiUrl, STEWARD_TENANT_ID } from '@/lib/auth/steward-config';

// ── Singleton StewardAuth instance ───────────────────────────────────────────

let _stewardAuthInstance: FeedStewardAuth | null = null;

function getOrCreateStewardAuth(): FeedStewardAuth {
  if (_stewardAuthInstance) return _stewardAuthInstance;
  const baseUrl = getStewardApiUrl();
  _stewardAuthInstance = new FeedStewardAuth({
    baseUrl,
    tenantId: STEWARD_TENANT_ID,
    // Persist session across page reloads
    storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
  });
  return _stewardAuthInstance;
}

// ── Context ───────────────────────────────────────────────────────────────────

interface StewardAuthContextValue {
  stewardAuth: FeedStewardAuth;
  session: StewardSession | null;
  isLoading: boolean;
  /** Call after a successful login to sync the httpOnly cookie and fetch the user profile. */
  onLoginSuccess: (
    token: string,
    refreshToken?: string | null
  ) => Promise<void>;
}

const syncSessionCookie = createSessionCookieSync();

const StewardAuthContext = createContext<StewardAuthContextValue | null>(null);

export function useStewardAuthContext(): StewardAuthContextValue {
  const ctx = useContext(StewardAuthContext);
  if (!ctx) {
    throw new Error(
      'useStewardAuthContext must be used inside StewardAuthProvider'
    );
  }
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function StewardAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const stewardAuth = useRef(getOrCreateStewardAuth()).current;
  const [session, setSession] = useState<StewardSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const synchronize = async (next: StewardSession | null) => {
      if (!next) {
        if (active) {
          setSession(null);
          setIsLoading(false);
        }
        await syncSessionCookie(null).catch(() => undefined);
        return;
      }
      try {
        await syncSessionCookie(
          next.token,
          stewardAuth.getRefreshToken(),
          () =>
            !stewardAuth.isLoginPending &&
            stewardAuth.getSession()?.token === next.token
        );
        if (
          active &&
          !stewardAuth.isLoginPending &&
          stewardAuth.getSession()?.token === next.token
        ) {
          setSession(next);
        }
      } catch {
        if (
          active &&
          !stewardAuth.isLoginPending &&
          stewardAuth.getSession()?.token === next.token
        ) {
          stewardAuth.signOut();
          setSession(null);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    const unsubscribe = stewardAuth.onSessionChange((next) => {
      void synchronize(next);
    });
    const checkRefresh = () => {
      if (!active || document.visibilityState === 'hidden') return;
      const current = stewardAuth.getSession();
      if (!current) setSession(null);
      if (!stewardAuth.getRefreshToken()) return;
      if (!current || stewardAuth.isNearExpiry()) {
        void stewardAuth.refreshSession();
      }
    };
    const timer = window.setInterval(checkRefresh, 30_000);
    window.addEventListener('focus', checkRefresh);
    document.addEventListener('visibilitychange', checkRefresh);
    checkRefresh();
    const restored = stewardAuth.getSession();
    if (restored) void synchronize(restored);
    else setIsLoading(false);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', checkRefresh);
      document.removeEventListener('visibilitychange', checkRefresh);
      unsubscribe();
    };
  }, [stewardAuth]);

  // The provider (not each useAuth consumer) owns the window-level token
  // adapters used by apiFetch, so unmounting one consumer cannot clear them
  // for the rest of the app.
  useEffect(() => {
    window.__privyAccessToken = session?.token ?? null;
  }, [session]);

  useEffect(() => {
    window.__privyGetAccessToken = async () => {
      const devSession = getBrowserDevAuthSession();
      if (devSession) return devSession.accessToken;
      return stewardAuth.getToken() ?? null;
    };
    return () => {
      window.__privyGetAccessToken = undefined;
    };
  }, [stewardAuth]);

  const onLoginSuccess = useCallback(
    async (token: string, refreshToken?: string | null) => {
      setIsLoading(true);
      try {
        const next = await stewardAuth.completeLogin(
          token,
          refreshToken,
          syncSessionCookie
        );
        if (stewardAuth.getSession()?.token === next?.token) setSession(next);
      } finally {
        setIsLoading(false);
      }
    },
    [stewardAuth]
  );

  return (
    <StewardAuthContext.Provider
      value={{ stewardAuth, session, isLoading, onLoginSuccess }}
    >
      {children}
    </StewardAuthContext.Provider>
  );
}
