import { describe, expect, it } from 'bun:test';
import {
  type EmbedAuthHost,
  type ExchangeCredentials,
  startEmbedAuthSession,
} from './embed-auth-session';

type Listener = (event: MessageEvent) => void;

function createHost() {
  const listeners = new Set<Listener>();
  const posted: unknown[] = [];
  const log: string[] = [];
  const parent = {
    postMessage: (message: unknown) => {
      log.push('ready');
      posted.push(message);
    },
  };
  const host: EmbedAuthHost = {
    parent,
    addEventListener: (_type, listener) => {
      log.push('listen');
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const dispatch = (data: unknown, source: unknown, origin: string) => {
    const event = { data, source, origin } as MessageEvent;
    for (const listener of listeners) listener(event);
  };
  return { host, parent, posted, log, listeners, dispatch };
}

function createCallbacks() {
  const state = {
    origins: [] as string[],
    agentIds: [] as string[],
    tokens: [] as string[],
    errors: [] as unknown[],
  };
  return {
    state,
    callbacks: {
      onOrigin: (o: string) => state.origins.push(o),
      onAgentId: (id: string) => state.agentIds.push(id),
      onSessionToken: (t: string) => state.tokens.push(t),
      onExchangeError: (e: unknown) => state.errors.push(e),
    },
  };
}

function deferredExchange() {
  const pending: Array<(token: string | null) => void> = [];
  const exchange: ExchangeCredentials = () =>
    new Promise((resolve) => {
      pending.push(resolve);
    });
  return { exchange, pending };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startEmbedAuthSession', () => {
  it('listens before announcing FEED_READY', () => {
    const { host, log, posted } = createHost();
    startEmbedAuthSession(host, createCallbacks().callbacks);
    expect(log).toEqual(['listen', 'ready']);
    expect(posted).toEqual([{ type: 'FEED_READY' }]);
  });

  it('ignores FEED_AUTH from windows other than the parent', () => {
    const { host, dispatch } = createHost();
    const { state, callbacks } = createCallbacks();
    startEmbedAuthSession(host, callbacks);
    dispatch(
      { type: 'FEED_AUTH', authToken: 'attacker' },
      {},
      'https://evil.example'
    );
    expect(state.tokens).toEqual([]);
    expect(state.origins).toEqual([]);
  });

  it('accepts a direct session token from the parent and binds its origin', () => {
    const { host, parent, dispatch } = createHost();
    const { state, callbacks } = createCallbacks();
    startEmbedAuthSession(host, callbacks);
    dispatch({ type: 'FEED_AUTH', authToken: ' tok ' }, parent, 'https://a');
    dispatch({ type: 'FEED_AUTH', authToken: 'other' }, parent, 'https://b');
    expect(state.tokens).toEqual(['tok']);
    expect(state.origins).toEqual(['https://a']);
  });

  it('only commits the latest credential exchange when responses reverse', async () => {
    const { host, parent, dispatch } = createHost();
    const { state, callbacks } = createCallbacks();
    const { exchange, pending } = deferredExchange();
    startEmbedAuthSession(host, callbacks, exchange);
    dispatch(
      { type: 'FEED_AUTH', agentId: 'a1', authToken: 's1' },
      parent,
      'https://host'
    );
    dispatch(
      { type: 'FEED_AUTH', agentId: 'a2', authToken: 's2' },
      parent,
      'https://host'
    );
    pending[1]?.('token-2');
    pending[0]?.('token-1');
    await flush();
    expect(state.agentIds).toEqual(['a1', 'a2']);
    expect(state.tokens).toEqual(['token-2']);
  });

  it('does not commit after dispose', async () => {
    const { host, parent, dispatch, listeners } = createHost();
    const { state, callbacks } = createCallbacks();
    const { exchange, pending } = deferredExchange();
    const dispose = startEmbedAuthSession(host, callbacks, exchange);
    dispatch(
      { type: 'FEED_AUTH', agentId: 'a1', authToken: 's1' },
      parent,
      'https://host'
    );
    dispose();
    pending[0]?.('token-1');
    await flush();
    expect(state.tokens).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});
