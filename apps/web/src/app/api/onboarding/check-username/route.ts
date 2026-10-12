/**
 * Username Availability Check API
 *
 * @description
 * Validates username availability during onboarding process. Provides
 * intelligent suggestions if requested username is taken. Sanitizes
 * usernames to ensure platform consistency and safety.
 *
 * **Features:**
 * - Real-time availability checking
 * - Automatic username sanitization
 * - Smart suggestions (appends numbers)
 * - Fallback random suffix if needed
 * - Case-insensitive checking
 * - Special character removal
 *
 * **Username Rules:**
 * - Length: 3-20 characters
 * - Allowed: a-z, A-Z, 0-9, underscore (_)
 * - Converted to lowercase
 * - Special chars converted to underscores
 * - Leading @ symbol removed
 *
 * **Suggestion Algorithm:**
 * 1. Check base username (after sanitization)
 * 2. If taken, check a bounded batch of numbered candidates (<= 20 chars)
 *    in one query and suggest the first free one
 * 3. If all candidates are taken, no suggestion is returned
 *
 * @openapi
 * /api/onboarding/check-username:
 *   get:
 *     tags:
 *       - Onboarding
 *     summary: Check username availability
 *     description: Validates username availability and provides suggestions if taken
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 3
 *           maxLength: 20
 *         description: Desired username to check
 *         example: alice_trader
 *     responses:
 *       200:
 *         description: Username check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                   description: Whether username is available
 *                 username:
 *                   type: string
 *                   description: Sanitized username checked
 *                 suggestion:
 *                   type: string
 *                   description: Suggested alternative (if unavailable)
 *             examples:
 *               available:
 *                 value:
 *                   available: true
 *                   username: alice_trader
 *               unavailable:
 *                 value:
 *                   available: false
 *                   username: alice
 *                   suggestion: alice1
 *       400:
 *         description: Invalid username (too short, too long, or missing)
 *
 * @example
 * ```typescript
 * // Check if username is available
 * const response = await fetch('/api/onboarding/check-username?username=alice');
 * const { available, username, suggestion } = await response.json();
 *
 * if (available) {
 *   console.log(`✓ ${username} is available!`);
 * } else {
 *   console.log(`✗ ${username} is taken. Try: ${suggestion}`);
 * }
 *
 * // Username sanitization examples:
 * // Input: "@Alice_Trader!" -> Output: "alice_trader"
 * // Input: "Bob Smith" -> Output: "bob_smith"
 * ```
 *
 * @see {@link /src/app/onboarding/page.tsx} Onboarding flow
 * @see {@link /lib/db/context} RLS context
 */

import {
  addPublicReadHeaders,
  errorResponse,
  publicRateLimit,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { db, inArray, users } from '@feed/db';
import {
  isValidOnboardingUsername,
  sanitizeOnboardingUsername,
} from '@feed/shared';
import type { NextRequest } from 'next/server';

const USERNAME_MAX_LENGTH = 20;
/** Bound on raw input before sanitization (sanitization truncates to 20). */
const RAW_USERNAME_MAX_LENGTH = 64;
const SUGGESTION_CANDIDATES = 25;

interface UsernameCheckResult {
  available: boolean;
  username: string;
  suggestion?: string;
}

function buildSuggestionCandidates(cleanUsername: string): string[] {
  const candidates: string[] = [];
  for (let n = 1; n <= SUGGESTION_CANDIDATES; n++) {
    const suffix = String(n);
    candidates.push(
      `${cleanUsername.slice(0, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`
    );
  }
  return candidates;
}

/**
 * Check availability of a sanitized username and suggest a free alternative.
 * Uses at most two bounded queries. Signup uniqueness remains authoritative.
 */
async function checkUsernameAvailability(
  cleanUsername: string
): Promise<UsernameCheckResult> {
  const candidates = buildSuggestionCandidates(cleanUsername);
  const taken = await db
    .select({ username: users.username })
    .from(users)
    .where(inArray(users.username, [cleanUsername, ...candidates]));
  const takenSet = new Set(taken.map((row) => row.username));

  if (!takenSet.has(cleanUsername)) {
    return { available: true, username: cleanUsername };
  }

  const suggestion = candidates.find(
    (candidate) => candidate !== cleanUsername && !takenSet.has(candidate)
  );
  return {
    available: false,
    username: cleanUsername,
    ...(suggestion ? { suggestion } : {}),
  };
}

export const GET = withErrorHandling(async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username');

  if (!username) {
    return errorResponse('Username is required', 'VALIDATION_ERROR', 400);
  }

  if (username.length > RAW_USERNAME_MAX_LENGTH) {
    return errorResponse('Username is too long', 'VALIDATION_ERROR', 400);
  }

  // Normalize first, then validate the normalized value (what signup stores).
  const cleanUsername = sanitizeOnboardingUsername(username);
  if (!isValidOnboardingUsername(cleanUsername)) {
    return errorResponse(
      'Username must be at least 3 characters (letters, numbers, underscores)',
      'VALIDATION_ERROR',
      400
    );
  }

  const { error, rateLimitInfo } = await publicRateLimit(request);
  if (error) return error;

  const result = await checkUsernameAvailability(cleanUsername);

  const res = successResponse(result);
  if (rateLimitInfo) addPublicReadHeaders(res, rateLimitInfo);
  return res;
});
