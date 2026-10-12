/**
 * Integration Test: General Game Feedback API
 *
 * Tests the /api/feedback/game-feedback endpoint for submitting
 * bug reports, feature requests, and performance feedback.
 *
 * Route handlers run in-process against the real `@feed/api` services and
 * authenticate with the dev `x-dev-user-id` bypass (NODE_ENV=test). Nothing
 * is module-mocked: `mock.module` is process-global in bun and leaked fake
 * `@feed/api` exports into every later integration file.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { db, feedbacks, inArray, users } from '@feed/db';
import { generateSnowflakeId } from '@feed/shared';
import { NextRequest } from 'next/server';
import { GET as getAdminFeedback } from '@/app/api/admin/feedback/route';
import { POST as submitGameFeedback } from '@/app/api/feedback/game-feedback/route';

const createdUserIds: string[] = [];

async function createUser(isAdmin: boolean): Promise<string> {
  const id = await generateSnowflakeId();
  await db.insert(users).values({
    id,
    username: `feedback-test-${id}`,
    displayName: 'Feedback Test User',
    isAdmin,
    isTest: true,
    updatedAt: new Date(),
  });
  createdUserIds.push(id);
  return id;
}

/**
 * Each submission comes from a fresh user so the real per-user
 * SUBMIT_FEEDBACK rate limit (5/min) never couples test cases.
 */
async function feedbackRequest(
  payload: Record<string, string | number>
): Promise<NextRequest> {
  return new NextRequest('http://localhost/api/feedback/game-feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: new Headers({
      'Content-Type': 'application/json',
      'x-dev-user-id': await createUser(false),
    }),
  });
}

let adminUserId = '';

function adminFeedbackRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/admin/feedback${query}`, {
    method: 'GET',
    headers: new Headers({ 'x-dev-user-id': adminUserId }),
  });
}

beforeAll(async () => {
  adminUserId = await createUser(true);
});

afterAll(async () => {
  await db
    .delete(feedbacks)
    .where(inArray(feedbacks.fromUserId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
});

describe('General Game Feedback API', () => {
  test('POST /api/feedback/game-feedback - bug report succeeds', async () => {
    const payload = {
      feedbackType: 'bug',
      description: 'Test bug report - the button does not work correctly',
      stepsToReproduce:
        '1. Click button\n2. Nothing happens\n3. Expected: modal opens',
    };

    const request = await feedbackRequest(payload);

    const response = await submitGameFeedback(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.feedbackId).toBeDefined();
    expect(json.message).toContain('feedback');

    // Verify feedback was created in DB
    const feedback = await db.feedback.findUnique({
      where: { id: json.feedbackId },
    });
    expect(feedback).toBeTruthy();
    expect(feedback?.category).toBe('bug_report');
    expect(feedback?.comment).toBe(payload.description);
  });

  test('POST /api/feedback/game-feedback - feature request succeeds', async () => {
    const payload = {
      feedbackType: 'feature_request',
      description: 'Test feature request - add dark mode toggle in settings',
      rating: 4,
    };

    const request = await feedbackRequest(payload);

    const response = await submitGameFeedback(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.feedbackId).toBeDefined();

    // Verify feedback was created with correct score
    const feedback = await db.feedback.findUnique({
      where: { id: json.feedbackId },
    });
    expect(feedback).toBeTruthy();
    expect(feedback?.category).toBe('feature_request');
    expect(feedback?.score).toBe(80); // rating 4 * 20 = 80
  });

  test('POST /api/feedback/game-feedback - performance issue succeeds', async () => {
    const payload = {
      feedbackType: 'performance',
      description:
        'Test performance issue - game lags when many agents are online',
    };

    const request = await feedbackRequest(payload);

    const response = await submitGameFeedback(request);
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.success).toBe(true);

    const feedback = await db.feedback.findUnique({
      where: { id: json.feedbackId },
    });
    expect(feedback).toBeTruthy();
    expect(feedback?.category).toBe('performance_issue');
    expect(feedback?.score).toBe(50); // default score when no rating
  });

  test('POST /api/feedback/game-feedback - rejects short description', async () => {
    const payload = {
      feedbackType: 'bug',
      description: 'Too short',
      stepsToReproduce: 'Steps here',
    };

    const request = await feedbackRequest(payload);

    const response = await submitGameFeedback(request);
    // Should fail validation - description must be at least 10 chars
    expect(response.status).toBe(400);
  });

  test('POST /api/feedback/game-feedback - bug report requires stepsToReproduce', async () => {
    const payload = {
      feedbackType: 'bug',
      description: 'This is a valid bug description that is long enough',
      // Missing stepsToReproduce
    };

    const request = await feedbackRequest(payload);

    const response = await submitGameFeedback(request);
    expect(response.status).toBe(400);
  });

  test('POST /api/feedback/game-feedback - feature request requires rating', async () => {
    const payload = {
      feedbackType: 'feature_request',
      description: 'This is a valid feature request description',
      // Missing rating
    };

    const request = await feedbackRequest(payload);

    const response = await submitGameFeedback(request);
    expect(response.status).toBe(400);
  });
});

describe('Admin Feedback API', () => {
  beforeAll(async () => {
    // Create test feedback for admin queries
    const payload = {
      feedbackType: 'bug',
      description: 'Admin test bug - searchable description for testing',
      stepsToReproduce: '1. Test step\n2. Another step',
    };

    const request = await feedbackRequest(payload);

    const response = await submitGameFeedback(request);
    expect(response.status).toBe(201);
  });

  test('GET /api/admin/feedback - returns feedback list', async () => {
    const request = adminFeedbackRequest();

    const response = await getAdminFeedback(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.feedback).toBeDefined();
    expect(Array.isArray(json.feedback)).toBe(true);
    expect(json.pagination).toBeDefined();
    expect(json.pagination.total).toBeGreaterThanOrEqual(0);
    expect(json.stats).toBeDefined();
  });

  test('GET /api/admin/feedback - filters by type', async () => {
    const request = adminFeedbackRequest('?type=bug');

    const response = await getAdminFeedback(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    // All returned feedback should be bugs
    for (const item of json.feedback) {
      expect(item.feedbackType).toBe('bug');
    }
  });

  test('GET /api/admin/feedback - rejects invalid type', async () => {
    const request = adminFeedbackRequest('?type=invalid_type');

    const response = await getAdminFeedback(request);
    expect(response.status).toBe(400);
  });

  test('GET /api/admin/feedback - search works', async () => {
    const request = adminFeedbackRequest('?search=searchable');

    const response = await getAdminFeedback(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    // Should find our test feedback
    const found = json.feedback.some((item: { description: string | null }) =>
      item.description?.includes('searchable')
    );
    expect(found).toBe(true);
  });

  test('GET /api/admin/feedback - pagination params work', async () => {
    const request = adminFeedbackRequest('?limit=5&offset=0');

    const response = await getAdminFeedback(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.pagination.limit).toBe(5);
    expect(json.pagination.offset).toBe(0);
    expect(json.feedback.length).toBeLessThanOrEqual(5);
  });

  test('GET /api/admin/feedback - hasLinearIssue filter works', async () => {
    const request = adminFeedbackRequest('?hasLinearIssue=false');

    const response = await getAdminFeedback(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    // All returned feedback should NOT have Linear issue
    for (const item of json.feedback) {
      expect(item.linearIssue).toBeNull();
    }
  });
});
