import { describe, expect, test } from 'bun:test';
import { LinkSocialAccountSchema } from '../../shared/src/validation/schemas/game';
import { OnboardingProfileSchema } from '../../shared/src/validation/schemas/onboarding';
import { ConnectSocialSchema } from '../../shared/src/validation/schemas/user';

describe('supported social platforms', () => {
  test('social linking rejects the retired platform', () => {
    for (const schema of [LinkSocialAccountSchema, ConnectSocialSchema]) {
      expect(schema.shape.platform.safeParse('farcaster').success).toBe(false);
      expect(schema.shape.platform.safeParse('twitter').success).toBe(true);
    }
  });
  test('onboarding rejects retired imports and strips historical identity fields', () => {
    const profile = { username: 'agent_user', displayName: 'Agent' };
    expect(
      OnboardingProfileSchema.safeParse({
        ...profile,
        importedFrom: 'farcaster',
      }).success
    ).toBe(false);
    const parsed = OnboardingProfileSchema.parse({
      ...profile,
      farcasterFid: '123',
      farcasterUsername: 'legacy',
    });
    expect(parsed).not.toHaveProperty('farcasterFid');
    expect(parsed).not.toHaveProperty('farcasterUsername');
    expect(
      OnboardingProfileSchema.safeParse({ ...profile, importedFrom: 'twitter' })
        .success
    ).toBe(true);
  });
});
