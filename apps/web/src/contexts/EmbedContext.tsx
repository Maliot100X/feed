'use client';

import { logger } from '@feed/shared';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { startEmbedAuthSession } from '@/lib/embed/embed-auth-session';

interface EmbedContextValue {
  /** True when the app is loaded inside an iframe with ?embedded=true. */
  isEmbedded: boolean;
  /** The parent origin that sent auth credentials, if any. */
  parentOrigin: string | null;
  /** Agent session token received via postMessage from the embedding host. */
  agentSessionToken: string | null;
  /** Agent ID received via postMessage. */
  agentId: string | null;
}

const EmbedContext = createContext<EmbedContextValue>({
  isEmbedded: false,
  parentOrigin: null,
  agentSessionToken: null,
  agentId: null,
});

export function useEmbedMode(): EmbedContextValue {
  return useContext(EmbedContext);
}

/**
 * Detects embed mode from URL params and listens for FEED_AUTH
 * postMessage from the embedding host (Milady desktop/web).
 *
 * Detects ?embedded=true (or being framed) and runs the parent-only auth
 * handshake from `startEmbedAuthSession`, storing the resulting credentials
 * in context (and on window for the API layer).
 */
export function EmbedModeProvider({ children }: { children: ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [parentOrigin, setParentOrigin] = useState<string | null>(null);
  const [agentSessionToken, setAgentSessionToken] = useState<string | null>(
    null
  );
  const [agentId, setAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const embedded =
      params.get('embedded') === 'true' || window.self !== window.top;

    if (!embedded) return;

    setIsEmbedded(true);

    const parent = window.parent;
    if (!parent || parent === window) return;

    const embedWindow = window as Window & {
      __feedEmbedAgentId?: string;
      __feedEmbedToken?: string;
    };

    return startEmbedAuthSession(
      {
        parent,
        addEventListener: (type, listener) =>
          window.addEventListener(type, listener),
        removeEventListener: (type, listener) =>
          window.removeEventListener(type, listener),
      },
      {
        onOrigin: setParentOrigin,
        onAgentId: (id) => {
          setAgentId(id);
          embedWindow.__feedEmbedAgentId = id;
        },
        onSessionToken: (token) => {
          setAgentSessionToken(token);
          embedWindow.__feedEmbedToken = token;
        },
        onExchangeError: (error) => {
          logger.warn(
            'Agent credential exchange failed',
            { error: String(error) },
            'EmbedModeProvider'
          );
        },
      }
    );
  }, []);

  return (
    <EmbedContext.Provider
      value={{ isEmbedded, parentOrigin, agentSessionToken, agentId }}
    >
      {children}
    </EmbedContext.Provider>
  );
}
