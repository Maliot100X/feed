#!/usr/bin/env bun
/**
 * Development wrapper — starts Next.js and the local cron simulator.
 */

import { $ } from 'bun';

const result =
  await $`concurrently --kill-others-on-fail -n "next,cron" -c "cyan,magenta" "cd apps/web && bun run dev" "bun run scripts/local-cron-simulator.ts"`.nothrow();

// Propagate a failed dev process instead of always exiting 0.
process.exit(result.exitCode);
