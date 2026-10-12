/**
 * Single source of the Steward auth endpoint and tenant for the browser.
 * The SDK client and the custom login modal must talk to the same server.
 */
export const STEWARD_TENANT_ID =
  process.env.NEXT_PUBLIC_STEWARD_TENANT_ID ?? 'feed';

export function getStewardApiUrl(): string {
  if (process.env.NEXT_PUBLIC_STEWARD_API_URL) {
    return process.env.NEXT_PUBLIC_STEWARD_API_URL;
  }
  // Local development runs Steward on :3200; deployed hosts use the hosted
  // Steward service.
  return typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost'
    ? 'https://auth.elizacloud.ai'
    : 'http://localhost:3200';
}
