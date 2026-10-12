type CookieRequest = (url: string, init: RequestInit) => Promise<Response>;

/** Serialize cookie writes and discard obsolete updates before sending them. */
export function createSessionCookieSync(request: CookieRequest = fetch) {
  let updates: Promise<void> = Promise.resolve();
  return (
    token: string | null,
    refreshToken?: string | null,
    isCurrent: () => boolean = () => true
  ) => {
    const update = async () => {
      if (!isCurrent()) return;
      const response = await request('/api/auth/session', {
        method: token ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: token ? JSON.stringify({ token, refreshToken }) : undefined,
      });
      if (!response.ok) {
        throw new Error(`Session cookie sync failed: ${response.status}`);
      }
    };
    const result = updates.then(update, update);
    updates = result;
    return result;
  };
}
