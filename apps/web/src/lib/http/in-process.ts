import { NextRequest } from 'next/server';

/**
 * Invoke a public JSON route handler in-process as an anonymous request.
 *
 * Used by routes that aggregate other public routes (RSS, ticker). No
 * cookies or auth headers are forwarded (outputs are publicly cached), and no
 * HTTP loopback to a possibly spoofed forwarded host — or to a Worker's own
 * hostname, which does not route back to the Worker — is made. Returns null
 * when the handler responds with a non-OK status.
 */
export async function loadAnonymousJson<T>(
  handler: (request: NextRequest) => Promise<Response>,
  url: URL
): Promise<T | null> {
  const response = await handler(new NextRequest(url));
  if (!response.ok) return null;
  return (await response.json()) as T;
}
