import type { AgentRuntime, Plugin, Provider } from '@elizaos/core';

/** Feed providers own their names; SDK defaults must not overwrite their data. */
export function installRuntimeProviders(
  runtime: Pick<AgentRuntime, 'providers'>,
  plugins: Plugin[]
): void {
  const configured = new Map<string, Provider>();
  for (const plugin of plugins) {
    for (const provider of plugin.providers ?? []) {
      if (configured.has(provider.name)) {
        throw new Error(
          `Duplicate configured context provider: ${provider.name}`
        );
      }
      configured.set(provider.name, provider);
    }
  }
  const providers = [
    ...runtime.providers.filter((provider) => !configured.has(provider.name)),
    ...configured.values(),
  ];
  runtime.providers.splice(0, runtime.providers.length, ...providers);
}
