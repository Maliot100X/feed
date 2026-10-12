/**
 * Embed auth handshake with the embedding host (Milady desktop/web).
 *
 * 1. Start listening for `{ type: "FEED_AUTH", authToken, agentId }` from the
 *    parent window only, bound to the first origin that authenticates.
 * 2. Announce `{ type: "FEED_READY" }` to the parent.
 * 3. Agent credentials (agentId + secret) are exchanged for a session token;
 *    a bare token is treated as a pre-authenticated session token.
 * A newer FEED_AUTH always supersedes a pending exchange, and nothing is
 * committed after `dispose()`.
 */

export interface EmbedAuthCallbacks {
  onOrigin: (origin: string) => void;
  onAgentId: (agentId: string) => void;
  onSessionToken: (token: string) => void;
  onExchangeError: (error: unknown) => void;
}

export interface EmbedAuthHost {
  parent: Pick<Window, 'postMessage'>;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void;
}

export type ExchangeCredentials = (
  agentId: string,
  agentSecret: string
) => Promise<string | null>;

export const exchangeAgentCredentials: ExchangeCredentials = async (
  agentId,
  agentSecret
) => {
  const res = await fetch('/api/agents/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, agentSecret }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { token?: string; sessionToken?: string };
  return json.token ?? json.sessionToken ?? null;
};

interface FeedAuthMessage {
  type: 'FEED_AUTH';
  authToken?: unknown;
  agentId?: unknown;
}

function isFeedAuthMessage(data: object): data is FeedAuthMessage {
  return 'type' in data && data.type === 'FEED_AUTH';
}

export function startEmbedAuthSession(
  host: EmbedAuthHost,
  callbacks: EmbedAuthCallbacks,
  exchange: ExchangeCredentials = exchangeAgentCredentials
): () => void {
  let boundOrigin: string | null = null;
  let generation = 0;
  let disposed = false;

  function handleMessage(event: MessageEvent) {
    if (disposed) return;
    // Only the embedding parent may hand us credentials.
    if (event.source !== host.parent) return;
    if (boundOrigin !== null && event.origin !== boundOrigin) return;

    const data: object | null =
      event.data && typeof event.data === 'object' ? event.data : null;
    if (!data || !isFeedAuthMessage(data)) return;

    const secret =
      typeof data.authToken === 'string' ? data.authToken.trim() : '';
    const id = typeof data.agentId === 'string' ? data.agentId.trim() : '';

    boundOrigin = event.origin;
    callbacks.onOrigin(event.origin);
    const current = ++generation;

    if (id) callbacks.onAgentId(id);

    if (id && secret) {
      exchange(id, secret).then(
        (token) => {
          if (disposed || current !== generation || !token) return;
          callbacks.onSessionToken(token);
        },
        (error: unknown) => {
          if (disposed || current !== generation) return;
          callbacks.onExchangeError(error);
        }
      );
    } else if (secret) {
      callbacks.onSessionToken(secret);
    }
  }

  // Listen before announcing readiness so an immediate reply is not missed.
  host.addEventListener('message', handleMessage);
  host.parent.postMessage({ type: 'FEED_READY' }, '*');

  return () => {
    disposed = true;
    host.removeEventListener('message', handleMessage);
  };
}
