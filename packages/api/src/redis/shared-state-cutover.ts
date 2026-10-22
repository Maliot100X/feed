import { timingSafeEqual } from 'node:crypto';

export function sharedStateMigrationPaused(value?: string): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('SHARED_STATE_MIGRATION_PAUSED must be true or false');
}

/** Run before constructing storage clients or invoking the application. */
export function sharedStateMigrationGate(
  request: Request,
  paused: string | undefined,
  secret: string | undefined
): Response | null {
  const isPaused = sharedStateMigrationPaused(paused);
  const path = new URL(request.url).pathname;
  if (path === '/__shared-state') {
    if (request.method !== 'GET')
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET' },
      });
    const supplied = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    if (
      !secret ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      });
    return null;
  }
  if (
    !isPaused ||
    (request.method === 'GET' &&
      (path === '/__deployment' || path === '/api/health'))
  )
    return null;
  return Response.json(
    { error: 'Temporarily unavailable. Please try again shortly.' },
    {
      status: 503,
      headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    }
  );
}
