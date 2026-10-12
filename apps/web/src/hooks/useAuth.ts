'use client';

import { logger } from '@feed/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStewardAuthContext } from '@/components/providers/StewardAuthProvider';
import { useLoginModal } from '@/hooks/useLoginModal';
import {
  clearBrowserDevAuthSession,
  getBrowserDevAuthSession,
} from '@/lib/auth/dev-auth';
import { clearUserChatCache } from '@/lib/chat/message-store';
import { type User, useAuthStore } from '@/stores/authStore';
import { useInteractionStore } from '@/stores/interactionStore';
import { useWidgetCacheStore } from '@/stores/widgetCacheStore';
import { apiFetch } from '@/utils/api-fetch';
import {
  listStorageKeys,
  readStorageItem,
  removeStorageItem,
} from '@/utils/browser-storage';

/**
 * Return type for the useAuth hook.
 */
interface UseAuthReturn {
  /** Whether auth is ready (session checked) */
  ready: boolean;
  /** Whether the user is currently authenticated */
  authenticated: boolean;
  /** Whether the user profile is currently loading */
  loadingProfile: boolean;
  /** The current authenticated user, or null if not authenticated */
  user: User | null;
  /** Whether the user needs to complete onboarding */
  needsOnboarding: boolean;
  /** Whether the server has been consulted for profile status this session */
  profileFetchStatus: 'idle' | 'loading' | 'done' | 'error';
  /** Function to open the login modal */
  login: () => void;
  /** Function to logout and clear all auth state */
  logout: () => Promise<void>;
  /** Function to refresh the current user profile */
  refresh: () => Promise<void>;
  /** Function to get the current access token */
  getAccessToken: () => Promise<string | null>;
}

// Global fetch deduplication — shared across all useAuth instances
let globalFetchInFlight: Promise<void> | null = null;
// Bumped on logout so an in-flight profile response from the previous
// session can never repopulate auth state afterwards.
let authSessionGeneration = 0;

/**
 * Main authentication hook.
 *
 * Phase 2: Backed by Steward auth (StewardAuth SDK) instead of Privy.
 * Authentication state comes from the Steward session (localStorage-backed
 * JWT) and an httpOnly `steward-token` cookie set by /api/auth/session.
 *
 * Login opens the custom Steward LoginModal. Logout clears both the SDK
 * session and the server-side cookie.
 */
export function useAuth(): UseAuthReturn {
  const { stewardAuth, session } = useStewardAuthContext();
  const { showLoginModal } = useLoginModal();
  const {
    user,
    isLoadingProfile,
    needsOnboarding,
    profileFetchStatus,
    setUser,
    setNeedsOnboarding,
    setProfileFetchStatus,
    setLoadedUserId,
    setIsLoadingProfile,
    clearAuth,
  } = useAuthStore();
  const queryClient = useQueryClient();
  const [devAuthSession, setDevAuthSession] = useState(() =>
    getBrowserDevAuthSession()
  );
  const hasClearedAuthRef = useRef(false);

  const authenticated = devAuthSession
    ? true
    : session !== null && stewardAuth.isAuthenticated();
  const ready = true; // Steward SDK initializes synchronously from localStorage

  // ── Token access ─────────────────────────────────────────────────────────

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (devAuthSession) return devAuthSession.accessToken;
    return stewardAuth.getToken() ?? null;
  }, [devAuthSession, stewardAuth]);

  // ── Dev auth sync ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setDevAuthSession(getBrowserDevAuthSession());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  // ── Profile fetch (dev auth) ──────────────────────────────────────────────

  const fetchDevCurrentUser = useCallback(async () => {
    if (!devAuthSession) return;
    const generation = authSessionGeneration;
    setIsLoadingProfile(true);
    setLoadedUserId(devAuthSession.userId);
    try {
      const response = await fetch('/api/users/me', {
        headers: { Authorization: `Bearer ${devAuthSession.accessToken}` },
        credentials: 'include',
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        authenticated: boolean;
        needsOnboarding: boolean;
        user: User | null;
      };
      if (generation !== authSessionGeneration) return;
      setNeedsOnboarding(data.needsOnboarding);
      if (data.user) {
        setUser({
          ...data.user,
          displayName:
            data.user.displayName?.trim() ||
            devAuthSession.displayName ||
            'Dev User',
          email: data.user.email ?? devAuthSession.email ?? undefined,
        });
      }
    } catch (error) {
      logger.warn(
        'Dev auth profile fetch failed',
        { error: error instanceof Error ? error.message : String(error) },
        'useAuth'
      );
    } finally {
      setIsLoadingProfile(false);
    }
  }, [
    devAuthSession,
    setIsLoadingProfile,
    setLoadedUserId,
    setNeedsOnboarding,
    setUser,
  ]);

  // ── Profile fetch (Steward) ───────────────────────────────────────────────

  const fetchCurrentUser = useCallback(async () => {
    if (!authenticated || !session) return;
    if (globalFetchInFlight) {
      await globalFetchInFlight;
      return;
    }

    const run = async () => {
      const generation = authSessionGeneration;
      setIsLoadingProfile(true);
      setProfileFetchStatus('loading');
      setLoadedUserId(session.userId ?? session.address);

      // Steward reads its token synchronously from storage; if it is not
      // there now, waiting will not produce one (session changes re-run
      // this effect). End in a terminal error state instead of loading.
      if (!stewardAuth.getToken()) {
        logger.warn(
          'Steward token unavailable for profile fetch',
          {},
          'useAuth'
        );
        setProfileFetchStatus('error');
        setIsLoadingProfile(false);
        return;
      }

      const referralCode =
        typeof window !== 'undefined'
          ? readStorageItem('sessionStorage', 'referralCode')
          : null;
      const url = referralCode
        ? `/api/users/me?ref=${encodeURIComponent(referralCode)}`
        : '/api/users/me';

      let response: Response;
      try {
        response = await apiFetch(url);
      } catch (networkError) {
        logger.warn(
          'Failed to reach /api/users/me — keeping persisted auth state',
          {
            error:
              networkError instanceof Error
                ? networkError.message
                : String(networkError),
          },
          'useAuth'
        );
        setProfileFetchStatus('error');
        setIsLoadingProfile(false);
        return;
      }

      if (response.status === 401) {
        setProfileFetchStatus('error');
        setIsLoadingProfile(false);
        return;
      }

      if (!response.ok) {
        logger.warn(
          'Non-OK response from /api/users/me — keeping persisted auth state',
          { status: response.status },
          'useAuth'
        );
        setProfileFetchStatus('error');
        setIsLoadingProfile(false);
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        authenticated: boolean;
        needsOnboarding: boolean;
        user: User | null;
      } | null;

      if (!data) {
        logger.warn('Malformed /api/users/me response', {}, 'useAuth');
        setProfileFetchStatus('error');
        setIsLoadingProfile(false);
        return;
      }

      // The user logged out while this request was in flight.
      if (generation !== authSessionGeneration) return;

      setNeedsOnboarding(data.needsOnboarding ?? false);
      setProfileFetchStatus('done');

      if (data.user) {
        setUser(data.user);
      } else {
        // Session valid but no profile yet — set minimal user
        const currentUser = useAuthStore.getState().user;
        if (!currentUser) {
          setUser({
            id: session.userId ?? session.address,
            displayName: session.email ?? 'Anonymous',
            email: session.email ?? undefined,
          });
        }
      }

      setIsLoadingProfile(false);
    };

    const promise = run().finally(() => {
      globalFetchInFlight = null;
    });
    globalFetchInFlight = promise;
    await promise;
  }, [
    authenticated,
    session,
    stewardAuth,
    setIsLoadingProfile,
    setProfileFetchStatus,
    setLoadedUserId,
    setNeedsOnboarding,
    setUser,
  ]);

  // ── Auth state changes ────────────────────────────────────────────────────

  useEffect(() => {
    if (devAuthSession) {
      hasClearedAuthRef.current = false;
      void fetchDevCurrentUser();
      return;
    }

    if (!authenticated) {
      if (hasClearedAuthRef.current) return;
      useAuthStore.getState().clearAuth();
      hasClearedAuthRef.current = true;

      // Clear stale Steward session keys from localStorage
      if (typeof window !== 'undefined') {
        const stewardKeys = listStorageKeys('localStorage').filter(
          (key) => key.startsWith('steward:') || key.startsWith('stwd-')
        );
        stewardKeys.forEach((key) => removeStorageItem('localStorage', key));
      }
      return;
    }

    hasClearedAuthRef.current = false;
    void fetchCurrentUser();
  }, [authenticated, devAuthSession, fetchCurrentUser, fetchDevCurrentUser]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const refresh = async () => {
    if (devAuthSession) {
      await fetchDevCurrentUser();
      return;
    }
    if (!authenticated) return;
    await fetchCurrentUser();
  };

  const handleLogin = useCallback(() => {
    showLoginModal();
  }, [showLoginModal]);

  const handleLogout = async () => {
    authSessionGeneration += 1;
    const logoutUserId = user?.id;
    queryClient.clear();
    // Drop per-user client caches that outlive the React Query cache.
    useInteractionStore.getState().resetStore();
    useWidgetCacheStore.getState().clearAll();
    if (logoutUserId) void clearUserChatCache(logoutUserId);

    if (devAuthSession) {
      clearBrowserDevAuthSession();
      setDevAuthSession(null);
      clearAuth();
      if (typeof window !== 'undefined') {
        (
          window as Window & { __privyAccessToken?: string | null }
        ).__privyAccessToken = null;
        removeStorageItem('localStorage', 'feed-auth');
      }
      globalFetchInFlight = null;
      return;
    }

    // Sign out from Steward SDK (clears localStorage token)
    stewardAuth.signOut();

    // Clear the httpOnly cookie via the session API
    await fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {
      // Non-critical — cookie will expire naturally
    });

    clearAuth();

    if (typeof window !== 'undefined') {
      (
        window as Window & { __privyAccessToken?: string | null }
      ).__privyAccessToken = null;
      removeStorageItem('localStorage', 'feed-auth');
    }

    globalFetchInFlight = null;

    logger.info(
      'User logged out and all auth state cleared',
      undefined,
      'useAuth'
    );
  };

  return {
    ready,
    authenticated,
    loadingProfile: isLoadingProfile,
    user,
    needsOnboarding,
    profileFetchStatus: devAuthSession ? 'done' : profileFetchStatus,
    login: handleLogin,
    logout: handleLogout,
    refresh,
    getAccessToken,
  };
}
