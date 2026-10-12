/**
 * Shared utilities for CLI commands.
 */

import consola from 'consola';
import type { FeedRuntimeConfig } from '../core/config';
import type { FeedEngine } from '../core/engine';
import { createEngineFromConfig, registerSystems } from '../core/runtime';
import { type ScanOptions, scanSystems } from '../core/scanner';
import { TickPhase } from '../core/types';

export const phaseNames: Record<number, string> = {
  [TickPhase.Bootstrap]: 'Bootstrap',
  [TickPhase.Questions]: 'Questions',
  [TickPhase.Events]: 'Events',
  [TickPhase.Markets]: 'Markets',
  [TickPhase.Rebalancing]: 'Rebalancing',
  [TickPhase.ContentMaintenance]: 'Content Maintenance',
  [TickPhase.Social]: 'Social',
  [TickPhase.Finalize]: 'Finalize',
};

export function phaseName(phase: number): string {
  return phaseNames[phase] ?? `Phase(${phase})`;
}

export async function buildEngine(
  config: FeedRuntimeConfig,
  rootDir: string,
  includeLegacy: boolean,
  options: ScanOptions = {}
): Promise<FeedEngine> {
  const engine = createEngineFromConfig(config);

  if (includeLegacy) {
    const { createLegacyGameTickSystem } = await import(
      '../core/bridge/legacy-game-tick'
    );
    engine.use(
      createLegacyGameTickSystem({
        skip: config.migratedSubsystems,
      })
    );
  }

  const { systems } = await scanSystems(
    config.systemsDir ?? './systems',
    rootDir,
    options
  );
  const scanned = registerSystems(engine, systems, config);

  consola.info(
    includeLegacy
      ? `Registered ${scanned} scanned system(s) + legacy bridge`
      : `Registered ${scanned} system(s)`
  );
  await engine.boot();
  return engine;
}

export function parseInterval(value: string, label: string): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    consola.warn(`Invalid ${label}: "${value}", defaulting to 60`);
    return 60;
  }
  return parsed;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([[\]|])/g, '\\$1');
}
