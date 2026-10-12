/**
 * System scanner — uses unimport to discover FeedSystem exports from a directory.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '@feed/shared';
import { scanDirExports } from 'unimport';
import { FrameworkError } from './errors';
import { resolveModuleSystems } from './runtime';
import type { FeedSystem } from './types';

export interface ScanResult {
  systems: FeedSystem[];
  files: string[];
}

export interface ScanOptions {
  /**
   * Bypass the module cache for discovered system files (dev hot-reload).
   * Only the system files themselves are re-evaluated; their transitive
   * imports may still be served from the module cache.
   */
  fresh?: boolean;
}

/**
 * Scan a directory for files exporting FeedSystem instances or classes.
 *
 * A missing directory yields no systems. Any failure to scan the directory,
 * load a file, or construct an exported system class rejects with the file
 * path so broken startup is never mistaken for an empty system set.
 */
export async function scanSystems(
  systemsDir: string,
  rootDir: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const absoluteDir = resolve(rootDir, systemsDir);
  const systems: FeedSystem[] = [];

  if (!existsSync(absoluteDir)) {
    logger.warn(
      `No systems directory found at ${absoluteDir}`,
      undefined,
      'Runtime'
    );
    return { systems: [], files: [] };
  }

  const exports = await scanDirExports([absoluteDir], {
    filePatterns: ['*.ts', '*.js', '*.mts', '*.mjs'],
  });
  const files = [...new Set(exports.map((exp) => exp.from))];

  for (const filePath of files) {
    if (options.fresh) {
      // Bun shares its module registry with require.cache; evicting the entry
      // forces the next import() to re-evaluate the changed file.
      delete require.cache[filePath];
    }
    let mod: Record<string, unknown>;
    try {
      mod = await import(filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new FrameworkError(
        `Failed to load system file ${filePath}: ${message}`
      );
    }

    for (const instance of resolveModuleSystems(mod, filePath)) {
      systems.push(instance);
      logger.info(
        `Discovered system "${instance.id}" from ${filePath}`,
        undefined,
        'Runtime'
      );
    }
  }

  return { systems, files };
}
