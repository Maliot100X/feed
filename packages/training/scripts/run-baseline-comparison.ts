#!/usr/bin/env bun

/**
 * Head-to-Head Benchmark Script
 *
 * Runs two parallel simulations on the exact same market conditions ("Fixed Seed").
 * Compares a random baseline against a momentum heuristic. No LLM or trained
 * model is involved; use run-benchmark-suite.ts / run-vllm-benchmark.ts for that.
 *
 * Usage:
 *   bun packages/training/scripts/run-baseline-comparison.ts
 */

import type { IAgentRuntime } from '@elizaos/core';
// Import initializeJsonMode to enable file-based DB for trajectory recording
// This prevents "Database not initialized" errors when saveTrajectory is true
import { initializeJsonMode } from '@feed/db';
import { mkdirSync } from 'fs';
import * as path from 'path';
import { type BenchmarkConfig } from '../src/benchmark/BenchmarkDataGenerator';
import { BenchmarkRunner } from '../src/benchmark/BenchmarkRunner';
import { MetricsVisualizer } from '../src/benchmark/MetricsVisualizer';
import { logger } from '../src/utils/logger';

// Mock Agent Runtime for the runner structure
const mockRuntime = {
  character: {
    settings: {
      model: 'gpt-4-turbo',
    },
  },
} as unknown as IAgentRuntime;

async function main() {
  console.log(
    '═══════════════════════════════════════════════════════════════'
  );
  console.log('  🥊 HEAD-TO-HEAD BENCHMARK: Random vs Momentum heuristic');
  console.log(
    '═══════════════════════════════════════════════════════════════\n'
  );

  const outputDir = path.join(
    process.cwd(),
    'benchmark-results',
    `h2h-${Date.now()}`
  );
  mkdirSync(outputDir, { recursive: true });

  // 0. Initialize Database in JSON Mode
  // This ensures TrajectoryRecorder writes to files instead of crashing on missing Postgres
  const dbPath = path.join(outputDir, 'db_storage');
  mkdirSync(dbPath, { recursive: true });
  try {
    initializeJsonMode(dbPath);
    logger.info(`Initialized JSON DB at ${dbPath}`);
  } catch (e) {
    logger.warn(
      'Could not initialize JSON DB mode. Trajectory recording might fail if no Postgres connection.',
      { error: e instanceof Error ? e.message : String(e) }
    );
  }

  // 1. Configuration for Fixed Benchmark
  const generatorConfig: BenchmarkConfig = {
    durationMinutes: 10,
    tickInterval: 1,
    numPredictionMarkets: 5,
    numPerpetualMarkets: 3,
    numAgents: 5,
    seed: 12345, // FIXED SEED for fairness
  };

  logger.info('Generating fixed benchmark snapshot...');

  // 2. Run Baseline (Random Strategy)
  // Note: We use the SAME generator config, so the runner will generate the SAME snapshot
  // because of the fixed seed.
  logger.info('>>> STARTING RUN A: BASELINE (RANDOM) <<<');
  const baselineResult = await BenchmarkRunner.runSingle({
    generatorConfig,
    agentRuntime: mockRuntime, // Not used for baseline strategy
    agentUserId: 'baseline-agent',
    saveTrajectory: false, // Baseline doesn't need trajectory recording
    outputDir: path.join(outputDir, 'baseline'),
    forceStrategy: 'random', // Force dumb strategy
  });

  // 3. Run challenger: the momentum heuristic (not an LLM agent).
  logger.info('>>> STARTING RUN B: CHALLENGER (MOMENTUM HEURISTIC) <<<');

  const challengerResult = await BenchmarkRunner.runSingle({
    generatorConfig, // Same config -> Same seed -> Same market conditions
    agentRuntime: mockRuntime,
    agentUserId: 'challenger-agent',
    saveTrajectory: true, // Record the challenger trajectory to analyze decisions
    outputDir: path.join(outputDir, 'challenger'),
    forceStrategy: 'momentum',
  });

  // 4. Generate Comparison Report
  await MetricsVisualizer.generateComparisonReport(
    baselineResult,
    challengerResult,
    outputDir
  );

  console.log(`\n✅ Benchmark complete. Results saved to: ${outputDir}`);

  process.exit(0);
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
