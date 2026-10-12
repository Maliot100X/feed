import {
  StewardAuth,
  type StewardAuthConfig,
  type StewardSession,
} from '@stwd/sdk';

const TOKEN_KEY = 'steward_session_token';
const REFRESH_KEY = 'steward_refresh_token';
type Storage = NonNullable<StewardAuthConfig['storage']>;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

/** SDK refreshes use an isolated snapshot so late responses cannot undo logout. */
export class FeedStewardAuth extends StewardAuth {
  private readonly sessionStorage: Storage;
  private readonly refreshListeners = new Set<
    (session: StewardSession | null) => void
  >();
  private refreshGeneration = 0;
  private loginRevision: number | null = null;
  private refreshInFlight: Promise<StewardSession | null> | null = null;

  constructor(config: StewardAuthConfig) {
    const storage = config.storage ?? memoryStorage();
    super({ ...config, storage });
    this.sessionStorage = storage;
    if (config.onSessionChange)
      this.refreshListeners.add(config.onSessionChange);
  }

  override getSession(): StewardSession | null {
    // The SDK deletes both tokens when the access token expires. Inspect a copy
    // instead, keeping the refresh token available after a suspended tab wakes.
    const token = this.sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const snapshot = memoryStorage();
    snapshot.setItem(TOKEN_KEY, token);
    return new StewardAuth({
      baseUrl: this.getBaseUrl(),
      storage: snapshot,
    }).getSession();
  }

  override onSessionChange(callback: (session: StewardSession | null) => void) {
    const unsubscribe = super.onSessionChange(callback);
    this.refreshListeners.add(callback);
    return () => {
      unsubscribe();
      this.refreshListeners.delete(callback);
    };
  }

  get sessionRevision() {
    return this.refreshGeneration;
  }

  cancelPendingRefresh() {
    this.refreshGeneration += 1;
    return this.refreshGeneration;
  }

  override signOut() {
    this.loginRevision = null;
    this.cancelPendingRefresh();
    super.signOut();
  }

  /** Import callback tokens through one owned storage contract. */
  acceptSession(token: string, refreshToken?: string | null) {
    this.loginRevision = null;
    this.cancelPendingRefresh();
    this.sessionStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) this.sessionStorage.setItem(REFRESH_KEY, refreshToken);
    else this.sessionStorage.removeItem(REFRESH_KEY);
    return this.getSession();
  }

  get isLoginPending() {
    return this.loginRevision !== null;
  }

  async completeLogin(
    token: string,
    refreshToken: string | null | undefined,
    syncCookie: (
      token: string,
      refreshToken: string | null | undefined,
      isCurrent: () => boolean
    ) => Promise<void>
  ): Promise<StewardSession | null> {
    const revision = this.cancelPendingRefresh();
    this.loginRevision = revision;
    const isCurrent = () => revision === this.refreshGeneration;
    try {
      await syncCookie(token, refreshToken, isCurrent);
      if (!isCurrent())
        throw new Error('Login was superseded by another session change');
      return this.acceptSession(token, refreshToken);
    } catch (error) {
      if (isCurrent()) this.signOut();
      throw error;
    } finally {
      if (this.loginRevision === revision) this.loginRevision = null;
    }
  }

  override refreshSession(): Promise<StewardSession | null> {
    if (this.isLoginPending) return Promise.resolve(null);
    if (this.refreshInFlight) return this.refreshInFlight;
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return Promise.resolve(null);
    const generation = this.refreshGeneration;
    const token = this.sessionStorage.getItem(TOKEN_KEY);
    const snapshot = memoryStorage();
    if (token) snapshot.setItem(TOKEN_KEY, token);
    snapshot.setItem(REFRESH_KEY, refreshToken);
    const isolated = new StewardAuth({
      baseUrl: this.getBaseUrl(),
      tenantId: this.getTenantId(),
      storage: snapshot,
    });
    const refresh = async () => {
      const next = await isolated.refreshSession();
      if (
        generation !== this.refreshGeneration ||
        this.getRefreshToken() !== refreshToken ||
        this.sessionStorage.getItem(TOKEN_KEY) !== token
      )
        return null;
      if (!next) {
        // Invalid credentials clear the snapshot; transient network failures do not.
        if (!isolated.getRefreshToken()) this.signOut();
        return null;
      }
      this.sessionStorage.setItem(TOKEN_KEY, next.token);
      const rotated = isolated.getRefreshToken();
      if (rotated) this.sessionStorage.setItem(REFRESH_KEY, rotated);
      for (const listener of this.refreshListeners) listener(next);
      return next;
    };
    this.refreshInFlight = refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }
}
