import { withErrorHandling } from '@feed/api';
import { NextResponse } from 'next/server';

/**
 * JSON 404 for unknown /api/* paths (instead of the HTML not-found page).
 * OPTIONS is also a 404 here; CORS preflight for /api/* is answered in
 * middleware first. Wrapped like every other route export (repo invariant).
 */
const notFoundResponse = withErrorHandling(async () =>
  NextResponse.json({ error: 'Not found' }, { status: 404 })
);

export const GET = notFoundResponse;
export const POST = notFoundResponse;
export const PUT = notFoundResponse;
export const PATCH = notFoundResponse;
export const DELETE = notFoundResponse;
export const OPTIONS = notFoundResponse;
