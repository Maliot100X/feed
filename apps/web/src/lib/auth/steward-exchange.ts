import { z } from 'zod';

export const stewardExchangeSchema = z.union([
  z.object({
    token: z.string().min(1),
    refreshToken: z.string().nullish(),
    mfaRequired: z.literal(false).optional(),
  }),
  z.object({
    mfaRequired: z.literal(true),
    mfa: z.object({
      type: z.enum(['totp', 'sms', 'passkey']),
      challengeId: z.string().min(1),
      expiresAt: z.string(),
    }),
  }),
]);

export type StewardLoginResult = z.infer<typeof stewardExchangeSchema>;

/** Steward sends one-time OAuth codes in the fragment to avoid access logs. */
export function stewardCallbackParams(url: URL) {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const value = (name: string) =>
    fragment.get(name) ?? url.searchParams.get(name) ?? undefined;
  return { code: value('code'), state: value('state'), error: value('error') };
}
