/**
 * Playwright API Request Helper for Integration Tests
 *
 * Provides a Playwright APIRequestContext for making authenticated API calls
 * in integration tests. Uses the authenticated state from Playwright setup.
 *
 * @module testing/integration/helpers/playwright-api
 */

import { type APIRequestContext, request } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

interface SavedTokens {
  TEST_USER_ID: string;
  TEST_ACCESS_TOKEN: string;
}

function parseSavedTokens(raw: string): SavedTokens {
  const data: { TEST_USER_ID?: unknown; TEST_ACCESS_TOKEN?: unknown } =
    JSON.parse(raw);
  if (
    typeof data.TEST_USER_ID !== 'string' ||
    !data.TEST_USER_ID ||
    typeof data.TEST_ACCESS_TOKEN !== 'string' ||
    !data.TEST_ACCESS_TOKEN
  ) {
    throw new Error(`Invalid token file ${tokenFile}`);
  }
  return {
    TEST_USER_ID: data.TEST_USER_ID,
    TEST_ACCESS_TOKEN: data.TEST_ACCESS_TOKEN,
  };
}

function parseMeUserId(body: { user?: { id?: unknown } }): string | null {
  return typeof body.user?.id === 'string' && body.user.id
    ? body.user.id
    : null;
}

const authFile = path.join(__dirname, '../../../.playwright/auth.json');
const tokenFile = path.join(__dirname, '../../../.playwright/test-tokens.json');
const rawBaseURL =
  process.env.TEST_BASE_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.TEST_API_URL ||
  process.env.API_URL ||
  'http://localhost:3000';
const baseURL = rawBaseURL.replace(/\/api$/, '');

let apiRequest: APIRequestContext | null = null;
let testUserId: string | null = null;

/**
 * Checks if Playwright authentication is available.
 *
 * Use this to conditionally skip tests when auth isn't set up.
 *
 * @returns `true` if auth file exists and tests can run
 */
export function isAuthAvailable(): boolean {
  return existsSync(authFile);
}

/**
 * Gets a descriptive reason why auth is not available.
 *
 * @returns Description of why auth is unavailable
 */
export function getAuthUnavailableReason(): string {
  if (!existsSync(authFile)) {
    return 'Playwright auth not set up (run: bunx playwright test --project=setup)';
  }
  return 'Unknown auth issue';
}

/**
 * Initializes Playwright API request context with authentication.
 *
 * @returns Promise resolving to API request context and test user ID
 */
export async function initPlaywrightAPI(): Promise<{
  apiRequest: APIRequestContext;
  testUserId: string;
}> {
  if (apiRequest && testUserId) {
    return { apiRequest, testUserId };
  }

  if (!existsSync(authFile)) {
    throw new Error(
      `Authentication state file not found: ${authFile}\n` +
        'Please run Playwright setup first:\n' +
        '  bunx playwright test --project=setup\n' +
        '  bunx playwright test --project=setup-integration-auth'
    );
  }

  // Browser localStorage tokens in storageState are not sent as HTTP
  // credentials, so the bearer token saved by auth setup is attached
  // explicitly.
  const tokens = existsSync(tokenFile)
    ? parseSavedTokens(readFileSync(tokenFile, 'utf-8'))
    : null;

  const context = await request.newContext({
    storageState: authFile,
    baseURL,
    extraHTTPHeaders: tokens
      ? { Authorization: `Bearer ${tokens.TEST_ACCESS_TOKEN}` }
      : undefined,
  });

  // Readiness requires the API to confirm the identity; a saved user id is
  // never substituted for a failed authentication.
  const response = await context.get(`${baseURL}/api/users/me`);
  const userId = response.ok() ? parseMeUserId(await response.json()) : null;
  if (!userId || (tokens && tokens.TEST_USER_ID !== userId)) {
    await context.dispose();
    throw new Error(
      `Playwright API authentication failed (GET /api/users/me -> ${response.status()}). ` +
        'Re-run: bunx playwright test --project=setup-integration-auth'
    );
  }

  apiRequest = context;
  testUserId = userId;
  return { apiRequest, testUserId };
}

/**
 * Cleans up Playwright API request context.
 */
export async function cleanupPlaywrightAPI(): Promise<void> {
  if (apiRequest) {
    await apiRequest.dispose();
    apiRequest = null;
  }
  testUserId = null;
}

/**
 * Gets the API base URL.
 *
 * @returns The API base URL string
 */
export function getAPIBaseURL(): string {
  return `${baseURL}/api`;
}
