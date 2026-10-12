/**
 * User Verify Share API
 *
 * @route POST /api/users/[userId]/verify-share - Verify share action
 * @access Authenticated
 *
 * @description
 * Verifies that a share action was actually completed (user posted on platform).
 * Awards points if verification succeeds. Supports Twitter.
 *
 * @openapi
 * /api/users/{userId}/verify-share:
 *   post:
 *     tags:
 *       - Users
 *     summary: Verify share action
 *     description: Verifies share was posted and awards points (authenticated user only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shareId
 *               - platform
 *             properties:
 *               shareId:
 *                 type: string
 *               platform:
 *                 type: string
 *                 enum: [twitter]
 *               postUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL to actual post for verification
 *     responses:
 *       200:
 *         description: Share verified successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not authorized for this user
 *
 * @example
 * ```typescript
 * await fetch(`/api/users/${userId}/verify-share`, {
 *   method: 'POST',
 *   headers: { 'Authorization': `Bearer ${token}` },
 *   body: JSON.stringify({
 *     shareId: 'share-id',
 *     platform: 'twitter',
 *     postUrl: 'https://twitter.com/...'
 *   })
 * });
 * ```
 */

import {
  AuthorizationError,
  authenticate,
  BusinessLogicError,
  ReputationService,
  requireUserByIdentifier,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { db, eq, shareActions, users } from '@feed/db';
import {
  logger,
  POINTS,
  SnowflakeIdSchema,
  toISOOrNull,
  UserIdParamSchema,
} from '@feed/shared';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  normalizeUsername,
  parseTwitterPostUrl,
  sharedUrlMatches,
  URL_IN_TEXT_PATTERN,
} from './share-url';

const VerifyShareRequestSchema = z.object({
  shareId: SnowflakeIdSchema,
  platform: z.enum(['twitter']),
  postUrl: z.string().url().optional(), // URL to the actual post for verification
});

interface TwitterLookupResponse {
  data?: {
    author_id?: string;
    entities?: {
      urls?: Array<{ expanded_url?: string }>;
    };
    text?: string;
  };
  includes?: {
    users?: Array<{
      id?: string;
      username?: string;
    }>;
  };
}

/**
 * POST /api/users/[userId]/verify-share
 * Verify that a share action was completed (user actually posted)
 */
export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ userId: string }> }
  ) => {
    // Authenticate user
    const authUser = await authenticate(request);
    const { userId } = UserIdParamSchema.parse(await context.params);

    // Check if the authenticated user has a database record
    if (!authUser.dbUserId) {
      throw new AuthorizationError(
        'User profile not found. Please complete onboarding first.',
        'share-verification',
        'create'
      );
    }

    const targetUser = await requireUserByIdentifier(userId, { id: true });
    const canonicalUserId = targetUser.id;

    // Verify user is verifying their own share
    if (authUser.dbUserId !== canonicalUserId) {
      throw new AuthorizationError(
        'You can only verify your own shares',
        'share-verification',
        'create'
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const { shareId, platform, postUrl } = VerifyShareRequestSchema.parse(body);

    // Get the share action
    const [shareAction] = await db
      .select()
      .from(shareActions)
      .where(eq(shareActions.id, shareId))
      .limit(1);

    if (!shareAction) {
      throw new BusinessLogicError('Share action not found', 'SHARE_NOT_FOUND');
    }

    if (shareAction.userId !== canonicalUserId) {
      throw new AuthorizationError(
        'You can only verify your own shares',
        'share-verification',
        'verify'
      );
    }

    if (shareAction.platform !== platform) {
      throw new BusinessLogicError(
        'Share platform does not match the verification platform',
        'SHARE_PLATFORM_MISMATCH'
      );
    }

    if (shareAction.verified) {
      // Calculate reputation based on platform (same logic as ReputationService.awardShareAction)
      const reputationAmount =
        platform === 'twitter' ? POINTS.SHARE_TO_TWITTER : POINTS.SHARE_ACTION;

      return successResponse({
        message: 'Share already verified',
        verified: true,
        shareAction,
        reputation: {
          awarded: shareAction.pointsAwarded ? reputationAmount : 0,
          newReputationTotal: 0,
          alreadyAwarded: shareAction.pointsAwarded,
        },
      });
    }

    // Require post URL for verification
    if (!postUrl) {
      throw new BusinessLogicError(
        'Post URL is required for verification',
        'MISSING_POST_URL'
      );
    }

    // Without a recorded shared link, any post by the user would "verify".
    if (!shareAction.url) {
      throw new BusinessLogicError(
        'This share has no link to verify against',
        'SHARE_URL_MISSING'
      );
    }
    const sharedUrl = shareAction.url;

    // Verify the post based on platform
    let verified = false;
    let verificationDetails: Record<string, string | boolean> = {};
    let verificationError: string | null = null;

    if (platform === 'twitter') {
      // Twitter verification - STRICT MODE
      // Extract tweet ID and optional username from URL.
      // Supports desktop and mobile copy-link formats.
      const parsedTweetUrl = parseTwitterPostUrl(postUrl);

      if (!parsedTweetUrl) {
        verificationError =
          'Invalid X URL format. Expected: https://x.com/username/status/123456789';
        logger.warn(
          `Invalid Twitter URL format: ${shareId}`,
          { shareId, postUrl, userId: canonicalUserId },
          'POST /api/users/[userId]/verify-share'
        );
      } else {
        const { tweetId, tweetUsername } = parsedTweetUrl;

        // Verify tweet exists using Twitter API v2
        const [user] = await db
          .select({
            twitterAccessToken: users.twitterAccessToken,
            twitterTokenExpiresAt: users.twitterTokenExpiresAt,
            twitterId: users.twitterId,
            twitterUsername: users.twitterUsername,
          })
          .from(users)
          .where(eq(users.id, canonicalUserId))
          .limit(1);

        // VALIDATION 1: Check if user has linked Twitter account
        if (!user?.twitterUsername) {
          verificationError =
            'Please link your Twitter/X account first to verify posts.';
          logger.warn(
            `User has no linked Twitter account: ${shareId}`,
            { shareId, userId: canonicalUserId },
            'POST /api/users/[userId]/verify-share'
          );
        } else {
          const twitterAuthAttempts: Array<{
            authType: 'app_bearer' | 'user_access_token';
            token: string;
          }> = [];

          if (process.env.TWITTER_BEARER_TOKEN) {
            twitterAuthAttempts.push({
              authType: 'app_bearer',
              token: process.env.TWITTER_BEARER_TOKEN,
            });
          }

          const isUserTokenExpired =
            !!user.twitterTokenExpiresAt &&
            user.twitterTokenExpiresAt.getTime() < Date.now();

          if (user.twitterAccessToken && !isUserTokenExpired) {
            twitterAuthAttempts.push({
              authType: 'user_access_token',
              token: user.twitterAccessToken,
            });
          } else if (user.twitterAccessToken && isUserTokenExpired) {
            logger.warn(
              `User Twitter access token expired, skipping fallback: ${shareId}`,
              {
                shareId,
                userId: canonicalUserId,
                expiredAt: toISOOrNull(user.twitterTokenExpiresAt),
              },
              'POST /api/users/[userId]/verify-share'
            );
          }

          if (twitterAuthAttempts.length === 0) {
            verificationError =
              'Twitter verification is not configured. Please contact support.';
            logger.error(
              'No Twitter auth token available for verification',
              { shareId, tweetId, userId: canonicalUserId },
              'POST /api/users/[userId]/verify-share'
            );
          } else {
            let twitterResponse!: Response;
            let twitterAuthTypeUsed!: 'app_bearer' | 'user_access_token';

            for (const [index, authAttempt] of twitterAuthAttempts.entries()) {
              twitterResponse = await fetch(
                `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=author_id,created_at,text,entities&expansions=author_id&user.fields=username`,
                {
                  headers: {
                    Authorization: `Bearer ${authAttempt.token}`,
                  },
                  signal: AbortSignal.timeout(10000),
                }
              );
              twitterAuthTypeUsed = authAttempt.authType;

              // Retry with another token only for explicit auth failures.
              const hasFallback = index < twitterAuthAttempts.length - 1;
              if (twitterResponse.status === 401 && hasFallback) {
                // Drain the response body to release the connection.
                await twitterResponse.text().catch((err) => {
                  logger.debug(
                    'Failed to drain Twitter response body',
                    { error: err, shareId },
                    'POST /api/users/[userId]/verify-share'
                  );
                });
                logger.warn(
                  `Twitter API auth failed, retrying with fallback token: ${shareId}`,
                  {
                    shareId,
                    tweetId,
                    attemptedAuthType: authAttempt.authType,
                    fallbackAuthType: twitterAuthAttempts[index + 1]?.authType,
                  },
                  'POST /api/users/[userId]/verify-share'
                );
                continue;
              }

              break;
            }

            if (twitterResponse.ok) {
              const tweetData =
                (await twitterResponse.json()) as TwitterLookupResponse;

              if (tweetData.data) {
                const userTwitterUsername = normalizeUsername(
                  user.twitterUsername
                );
                const userTwitterId = user.twitterId || '';
                const urlTwitterUsername = tweetUsername
                  ? normalizeUsername(tweetUsername)
                  : null;
                const tweetAuthorId = tweetData.data.author_id || '';
                const tweetAuthorUsername =
                  tweetData.includes?.users?.find(
                    (tweetUser) => tweetUser.id === tweetAuthorId
                  )?.username || '';
                const normalizedTweetAuthorUsername = tweetAuthorUsername
                  ? normalizeUsername(tweetAuthorUsername)
                  : '';

                // VALIDATION 2: URL username (when present) must match linked username.
                if (
                  urlTwitterUsername &&
                  userTwitterUsername !== urlTwitterUsername
                ) {
                  verificationError = `This tweet URL is from @${tweetUsername}, but your linked account is @${user.twitterUsername}. You can only verify your own posts.`;
                  logger.warn(
                    `Tweet URL username mismatch: ${shareId}`,
                    {
                      shareId,
                      expectedUsername: userTwitterUsername,
                      actualUrlUsername: urlTwitterUsername,
                    },
                    'POST /api/users/[userId]/verify-share'
                  );
                } else {
                  // VALIDATION 3: Tweet author must match the linked account.
                  // The immutable provider ID is authoritative when linked;
                  // the mutable handle is only used for legacy links without
                  // a stored ID.
                  const isAuthorMatch = userTwitterId
                    ? !!tweetAuthorId && userTwitterId === tweetAuthorId
                    : !!normalizedTweetAuthorUsername &&
                      userTwitterUsername === normalizedTweetAuthorUsername;

                  if (!isAuthorMatch) {
                    verificationError =
                      'This tweet was not posted by your linked X account. Please paste a tweet from your own account.';
                    logger.warn(
                      `Tweet author mismatch: ${shareId}`,
                      {
                        shareId,
                        userTwitterId,
                        tweetAuthorId,
                        userTwitterUsername,
                        tweetAuthorUsername: normalizedTweetAuthorUsername,
                      },
                      'POST /api/users/[userId]/verify-share'
                    );
                  } else {
                    // VALIDATION 4: Verify tweet contains the shared URL.
                    // Twitter converts URLs to t.co links, so we also check expanded URLs.
                    const tweetText = tweetData.data.text || '';

                    const expandedUrls = (tweetData.data.entities?.urls || [])
                      .map((urlEntity) => urlEntity.expanded_url)
                      .filter((url): url is string => Boolean(url));

                    const containsUrlInText = (
                      tweetText.match(URL_IN_TEXT_PATTERN) ?? []
                    ).some((textUrl) => sharedUrlMatches(sharedUrl, textUrl));
                    const containsUrlInEntities = expandedUrls.some(
                      (expandedUrl) => sharedUrlMatches(sharedUrl, expandedUrl)
                    );

                    const containsUrl =
                      containsUrlInText || containsUrlInEntities;

                    if (!containsUrl) {
                      verificationError = `This tweet does not contain the shared link (${sharedUrl}). Please paste the tweet where you actually shared the link.`;
                      logger.warn(
                        `Tweet does not contain shared URL: ${shareId}`,
                        {
                          shareId,
                          tweetText: tweetText.substring(0, 100),
                          expectedUrl: sharedUrl,
                          expandedUrls,
                        },
                        'POST /api/users/[userId]/verify-share'
                      );
                    } else {
                      // All validations passed.
                      verified = true;
                      verificationDetails = {
                        tweetId,
                        tweetUrl: postUrl,
                        tweetUsername: tweetUsername || user.twitterUsername,
                        verificationMethod:
                          'twitter_api_v2_with_author_and_url_verification',
                        verified: true,
                        tweetText: tweetData.data.text || '',
                        tweetAuthorId,
                        tweetAuthorUsername:
                          normalizedTweetAuthorUsername ||
                          userTwitterUsername ||
                          '',
                        verifiedAt: new Date().toISOString(),
                        urlMatch: containsUrl,
                        urlMatchMethod: containsUrlInEntities
                          ? 'expanded_urls'
                          : 'text',
                        expandedUrls: expandedUrls.join(', '),
                        authorMatch: true,
                        authMethodUsed: twitterAuthTypeUsed,
                      };

                      logger.info(
                        `Twitter share verified via API: ${shareId}`,
                        {
                          shareId,
                          tweetId,
                          tweetUsername:
                            tweetUsername || normalizedTweetAuthorUsername,
                          userId: canonicalUserId,
                          urlMatchMethod: containsUrlInEntities
                            ? 'expanded_urls'
                            : 'text',
                          authMethodUsed: twitterAuthTypeUsed,
                        },
                        'POST /api/users/[userId]/verify-share'
                      );
                    }
                  }
                }
              } else {
                verificationError = 'Tweet not found or has been deleted';
                logger.warn(
                  `Tweet not found in API response: ${shareId}`,
                  { shareId, tweetId, authMethodUsed: twitterAuthTypeUsed },
                  'POST /api/users/[userId]/verify-share'
                );
              }
            } else if (twitterResponse.status === 404) {
              verificationError =
                'Tweet not found. Please check the URL and try again.';
              logger.warn(
                `Tweet not found (404): ${shareId}`,
                { shareId, tweetId, authMethodUsed: twitterAuthTypeUsed },
                'POST /api/users/[userId]/verify-share'
              );
            } else if (twitterResponse.status === 401) {
              verificationError =
                'Twitter authentication failed during verification. Please reconnect your X account and try again.';
              logger.error(
                `Twitter API auth error: ${shareId}`,
                {
                  shareId,
                  tweetId,
                  status: twitterResponse.status,
                  authMethodUsed: twitterAuthTypeUsed,
                  attemptedAuthMethods: twitterAuthAttempts.map(
                    (attempt) => attempt.authType
                  ),
                },
                'POST /api/users/[userId]/verify-share'
              );
            } else {
              verificationError = `Twitter API error (${twitterResponse.status}). Please try again later.`;
              logger.error(
                `Twitter API error: ${shareId}`,
                {
                  shareId,
                  tweetId,
                  status: twitterResponse.status,
                  authMethodUsed: twitterAuthTypeUsed,
                },
                'POST /api/users/[userId]/verify-share'
              );
            }
          }
        }
      }
    }

    // Award reputation only if verification succeeded.
    let reputationAwarded = 0;
    let newReputationTotal = 0;

    if (verified) {
      // Award reputation through ReputationService.
      const reputationResult = await ReputationService.awardShareAction(
        canonicalUserId,
        platform,
        shareAction.contentType,
        shareAction.contentId || undefined
      );

      if (reputationResult.success) {
        reputationAwarded = reputationResult.reputationAwarded;
        newReputationTotal = reputationResult.newReputationTotal;

        logger.info(
          `Awarded ${reputationAwarded} reputation for a verified share`,
          { shareId, userId: canonicalUserId, platform, reputationAwarded },
          'POST /api/users/[userId]/verify-share'
        );
      }
    }

    // Update share action with verification status and points
    const [updatedShareAction] = await db
      .update(shareActions)
      .set({
        verified,
        verifiedAt: verified ? new Date() : null,
        verificationDetails: verified
          ? JSON.stringify(verificationDetails)
          : null,
        pointsAwarded: verified && reputationAwarded > 0,
      })
      .where(eq(shareActions.id, shareId))
      .returning();

    return successResponse({
      verified,
      shareAction: updatedShareAction,
      reputation: {
        awarded: reputationAwarded,
        newReputationTotal,
      },
      message: verified
        ? `Share verified successfully! You earned ${reputationAwarded} reputation.`
        : verificationError ||
          'Could not verify share. Please provide a valid post URL.',
    });
  }
);
