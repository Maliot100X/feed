/**
 * Storage Provider Factory
 *
 * Creates and configures storage providers based on the specified mode.
 */

import { JsonStorageProvider } from './adapters/json';
import type {
  IStorageProvider,
  StorageProviderConfig,
} from './ports/storage-provider';
import { setStorageProvider } from './ports/storage-provider';

/**
 * Create a storage provider based on configuration.
 *
 * @example
 * ```typescript
 * // For simulation/training (no database needed)
 * const provider = await createStorageProvider({
 *   mode: 'json',
 *   jsonBasePath: './simulation-data',
 * });
 * ```
 *
 * Production code uses @feed/db directly; there is no PostgreSQL provider.
 */
export async function createStorageProvider(
  config: StorageProviderConfig
): Promise<IStorageProvider> {
  const mode: string = config.mode;
  if (mode !== 'json' && mode !== 'memory') {
    throw new Error(
      `Unsupported storage mode: ${mode}. Supported modes: json, memory.`
    );
  }
  // Memory mode uses the JSON provider with all implicit disk I/O disabled.
  const provider: IStorageProvider = new JsonStorageProvider(config);

  // Initialize and set as global provider
  await provider.initialize();
  setStorageProvider(provider);

  return provider;
}

/**
 * Create a JSON storage provider for simulation.
 * Convenience function with sensible defaults.
 */
export async function createSimulationStorage(
  basePath = './simulation-data'
): Promise<IStorageProvider> {
  return createStorageProvider({
    mode: 'json',
    jsonBasePath: basePath,
    persistOnChange: true,
  });
}

/**
 * Create an in-memory storage provider for testing.
 * Data is not persisted to disk.
 */
export async function createTestStorage(): Promise<IStorageProvider> {
  return createStorageProvider({
    mode: 'memory',
    persistOnChange: false,
  });
}
