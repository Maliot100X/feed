/**
 * Onboarding Generate Profile API
 *
 * @route POST /api/onboarding/generate-profile - Generate AI profile
 * @access Authenticated (rate-limited; invokes a paid LLM)
 *
 * @description
 * Generates AI profile data for new users including name, bio, and other
 * profile fields. Uses AI to create personalized profile content.
 *
 * @openapi
 * /api/onboarding/generate-profile:
 *   post:
 *     tags:
 *       - Onboarding
 *     summary: Generate AI profile
 *     description: Generates AI profile data for new users
 *     responses:
 *       200:
 *         description: Profile generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 bio:
 *                   type: string
 *                 username:
 *                   type: string
 *       401:
 *         description: Authentication required
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: AI generation failed
 *
 * @example
 * ```typescript
 * const profile = await fetch('/api/onboarding/generate-profile', {
 *   method: 'POST',
 * }).then(r => r.json());
 * ```
 */

import {
  authenticate,
  checkRateLimitAsync,
  RATE_LIMIT_CONFIGS,
  rateLimitError,
  successResponse,
  withErrorHandling,
} from '@feed/api';
import { FeedLLMClient } from '@feed/engine';
import {
  isValidOnboardingUsername,
  sanitizeOnboardingUsername,
} from '@feed/shared';
import type { NextRequest } from 'next/server';
import {
  adjectives,
  animals,
  colors,
  countries,
  names,
  starWars,
  uniqueNamesGenerator,
} from 'unique-names-generator';
import { z } from 'zod';

const GeneratedProfileSchema = z.object({
  name: z.string().trim().min(1).max(50),
  username: z.string().trim().min(1).max(64),
  bio: z.string().trim().max(160),
});

type ProfileData = z.infer<typeof GeneratedProfileSchema>;

/**
 * GET /api/onboarding/generate-profile
 * Generate AI profile data for onboarding
 */
export const POST = withErrorHandling(async function POST(
  request: NextRequest
) {
  const authUser = await authenticate(request);
  const rateLimit = await checkRateLimitAsync(
    authUser.userId,
    RATE_LIMIT_CONFIGS.GENERATE_ONBOARDING_PROFILE
  );
  if (!rateLimit.allowed) {
    return rateLimitError(rateLimit.retryAfter);
  }

  // Use game tick LLM client
  const llmClient = FeedLLMClient.forGameTick();

  // Generate random words for entropy/inspiration
  const randomAnimal = uniqueNamesGenerator({
    dictionaries: [animals],
    length: 1,
  });
  const randomColor = uniqueNamesGenerator({
    dictionaries: [colors],
    length: 1,
  });
  const randomAdjective = uniqueNamesGenerator({
    dictionaries: [adjectives],
    length: 1,
  });
  const randomCountry = uniqueNamesGenerator({
    dictionaries: [countries],
    length: 1,
  });
  const randomName = uniqueNamesGenerator({ dictionaries: [names], length: 1 });
  const randomStarWars = uniqueNamesGenerator({
    dictionaries: [starWars],
    length: 1,
  });

  const prompt = `Generate a fun, memetic profile for a new social media user in the style of crypto/tech Twitter.

Requirements:
- name: A display name (2-3 words, creative, internet culture inspired)
- username: A handle without @ (alphanumeric and underscores only, 8-15 chars)
- bio: A short, funny bio (10-50 chars, meme-worthy, relatable to internet/crypto culture)

Examples:
{
  "name": "Cyber Chad",
  "username": "cyber_chad_69",
  "bio": "WAGMI 🚀"
}

{
  "name": "Degen Wizard",
  "username": "degen_wizard",
  "bio": "Professional meme investor 📈"
}

Generate a UNIQUE profile (don't copy examples). Keep it fun and shareable!

Here are some random words for inspiration (feel free to use or ignore):
- Animal: ${randomAnimal}
- Color: ${randomColor}
- Adjective: ${randomAdjective}
- Place: ${randomCountry}
- Name: ${randomName}
- Pop Culture: ${randomStarWars}

Return only a JSON object with exactly these keys: "name", "username", "bio".`;

  const rawProfileData = await llmClient.generateJSON<ProfileData>(
    prompt,
    {
      required: ['name', 'username', 'bio'],
      properties: {
        name: { type: 'string' },
        username: { type: 'string' },
        bio: { type: 'string' },
      },
    },
    {
      temperature: 1.0,
      maxTokens: 500,
      promptType: 'generate_onboarding_profile',
    }
  );

  const parsed = GeneratedProfileSchema.safeParse(rawProfileData);
  if (!parsed.success) {
    // Model output problem, not a client validation error.
    throw new Error(
      `Generated onboarding profile failed validation: ${parsed.error.message}`
    );
  }
  const generated = parsed.data;
  const username = sanitizeOnboardingUsername(generated.username);
  // The username is only a suggestion; availability is checked separately.
  const profileData: ProfileData = {
    name: generated.name,
    bio: generated.bio,
    username: isValidOnboardingUsername(username) ? username : '',
  };

  return successResponse(profileData);
});
