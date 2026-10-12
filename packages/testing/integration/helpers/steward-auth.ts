import { SignJWT } from 'jose';

/** Sign a short-lived fixture token using the same key as the test server. */
export async function createStewardTestToken(
  stewardUserId: string
): Promise<string> {
  const secret = process.env.STEWARD_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'STEWARD_JWT_SECRET must match the integration test server'
    );
  }
  return new SignJWT({ userId: stewardUserId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('steward')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}
