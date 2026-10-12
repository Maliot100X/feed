import { expect, test } from 'bun:test';
import type { Provider } from '@elizaos/core';
import { installRuntimeProviders } from '../../agents/src/runtime/runtime-providers';

test('Feed history replaces a same-name SDK provider instead of having its values overwritten', async () => {
  const sdk: Provider = {
    name: 'RECENT_MESSAGES',
    get: async () => ({ values: { recentMessages: '' } }),
  };
  const feed: Provider = {
    name: 'RECENT_MESSAGES',
    get: async () => ({
      values: { recentMessages: 'actual database history' },
    }),
  };
  const runtime = { providers: [feed, sdk] };
  const plugins = [
    { name: 'feed-chat', description: 'chat', providers: [feed] },
  ];
  installRuntimeProviders(runtime, plugins);
  expect(runtime.providers).toEqual([feed]);
  installRuntimeProviders(runtime, plugins);
  expect(runtime.providers).toEqual([feed]);
  expect(() =>
    installRuntimeProviders(runtime, [...plugins, ...plugins])
  ).toThrow('Duplicate');
});
