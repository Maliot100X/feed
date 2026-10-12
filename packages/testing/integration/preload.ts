/**
 * Preload file for integration tests
 *
 * This file is loaded before all integration tests to:
 * 1. Set up the test environment variables and timeouts
 * 2. Verify the database connection
 * 3. Disconnect the database when the run drains
 *
 * @module testing/integration/preload
 */

import { setDefaultTimeout } from 'bun:test';

// Set test environment first (before any imports)
// Using bracket notation to bypass readonly property check
(process.env as Record<string, string>)['NODE_ENV'] = 'test';
(process.env as Record<string, string>)['BUN_ENV'] = 'test';

setDefaultTimeout(30000);

// Reduce LLM timeout for tests (30 seconds instead of default)
process.env.LLM_TIMEOUT_MS = '30000';

import { db } from '@feed/db';

// Global flag to track if database is available
let dbAvailable = false;

/**
 * Check if database is available
 */
export function isDatabaseAvailable(): boolean {
  return dbAvailable;
}

/**
 * Verify the database connection.
 *
 * No data is deleted here: suites own and clean up the fixtures they create.
 * Pattern-based cleanup (users named test-*, locks containing "test",
 * serverless locks by age) could delete live data in any database that is
 * not disposable.
 */
async function initializeTestEnvironment(): Promise<void> {
  console.log('[Test Preload] Initializing integration test environment...');
  await db.$queryRaw`SELECT 1`;
  console.log('[Test Preload] ✅ Database connection verified');
  dbAvailable = true;
}

await initializeTestEnvironment();

// Disconnect once when the event loop drains. Signals keep their default
// behavior so interrupted runs exit non-zero.
process.once('beforeExit', () => {
  void db.$disconnect();
});
