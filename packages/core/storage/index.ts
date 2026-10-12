/**
 * Feed Storage Abstraction Layer
 *
 * Provides database-agnostic storage interfaces for offline use:
 * - JSON files (simulation, training, debugging)
 * - In-memory (testing, benchmarking; no disk I/O)
 *
 * Production code uses @feed/db directly; there is no PostgreSQL provider.
 *
 * Usage:
 * ```typescript
 * import { createStorageProvider, getStorageProvider } from '@feed/core/storage';
 *
 * // Initialize with JSON mode for simulation
 * const provider = await createStorageProvider({ mode: 'json', jsonBasePath: './simulation-data' });
 *
 * // Access through global context
 * const posts = await getStorageProvider().posts.getRecentPosts();
 * ```
 */

// Adapters
export * from './adapters';
// Factory functions
export * from './factory';
// Ports (interfaces)
export * from './ports';
// Types
export * from './types';
