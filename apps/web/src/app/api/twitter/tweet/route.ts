/**
 * Twitter Tweet API
 *
 * @route POST /api/twitter/tweet - Post tweet
 * @access Authenticated
 *
 * @description
 * Posts a tweet to Twitter/X using OAuth 2.0. Requires user to have connected
 * their Twitter account. Share tracking is performed by the client via
 * POST /api/users/[userId]/share; contentType/contentId are accepted but unused.
 *
 * @openapi
 * /api/twitter/tweet:
 *   post:
 *     tags:
 *       - Twitter
 *     summary: Post tweet
 *     description: Posts a tweet to Twitter/X using OAuth 2.0
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 minLength: 1
 *                 description: Tweet text content
 *               contentType:
 *                 type: string
 *                 enum: [market, profile, referral]
 *                 description: Accepted for compatibility (unused)
 *               contentId:
 *                 type: string
 *                 description: Accepted for compatibility (unused)
 *     responses:
 *       200:
 *         description: Tweet posted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tweetUrl:
 *                   type: string
 *       400:
 *         description: Missing or invalid tweet text
 *       401:
 *         description: Twitter account not connected or token rejected
 *       502:
 *         description: Provider error or response without a post id
 *
 * @example
 * ```typescript
 * await fetch('/api/twitter/tweet', {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${token}` },
 *   body: JSON.stringify({
 *     text: 'Check out this market!',
 *     contentType: 'market',
 *     contentId: 'market-id'
 *   })
 * });
 * ```
 */

import {
  authenticate,
  requireUserByIdentifier,
  withErrorHandling,
} from '@feed/api';
import { logger } from '@feed/shared';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const TweetBodySchema = z.object({
  text: z.string().trim().min(1, 'Missing tweet text').max(25_000),
  contentType: z.enum(['market', 'profile', 'referral']).optional(),
  contentId: z.string().max(200).optional(),
});

export const POST = withErrorHandling(async function POST(
  request: NextRequest
) {
  const authUser = await authenticate(request);
  const user = await requireUserByIdentifier(authUser.userId, {
    id: true,
    username: true,
    twitterAccessToken: true,
    twitterUsername: true,
  });

  if (!user.twitterAccessToken) {
    return NextResponse.json(
      {
        error:
          'Twitter account not connected. Please connect your X account first.',
      },
      { status: 401 }
    );
  }

  // Parse request body (contentType/contentId are accepted for compatibility;
  // share tracking is done by the client via POST /api/users/[userId]/share).
  const { text } = TweetBodySchema.parse(await request.json());

  logger.info(
    'Posting tweet via OAuth 2.0',
    {
      userId: user.id,
      textLength: text.length,
    },
    'TwitterPost'
  );

  // Create tweet payload
  const tweetPayload = { text };

  // Post the tweet using OAuth 2.0 Bearer token
  const tweetResponse = await fetch('https://api.twitter.com/2/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${user.twitterAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tweetPayload),
  });

  if (!tweetResponse.ok) {
    const errorText = await tweetResponse.text();
    logger.error(
      'Tweet creation failed',
      { error: errorText, status: tweetResponse.status },
      'TwitterPost'
    );
    // Provider error bodies are logged, not forwarded to the client.
    return NextResponse.json(
      { error: 'Failed to post tweet' },
      { status: tweetResponse.status === 401 ? 401 : 502 }
    );
  }

  const responseData = (await tweetResponse.json()) as {
    data?: { id?: string; text?: string };
  };
  const tweetId = responseData.data?.id;
  if (!tweetId || !/^\d+$/.test(tweetId)) {
    logger.error(
      'Tweet response missing a valid id',
      { userId: user.id },
      'TwitterPost'
    );
    return NextResponse.json(
      { error: 'Tweet status unknown: provider returned no post id' },
      { status: 502 }
    );
  }

  logger.info(
    'Tweet posted successfully via OAuth 2.0',
    { userId: user.id, tweetId },
    'TwitterPost'
  );

  return NextResponse.json({
    success: true,
    tweet: responseData,
    tweetUrl: `https://x.com/${user.twitterUsername || 'i'}/status/${tweetId}`,
  });
});
