/**
 * Read a human-readable error message from a failed API response.
 *
 * API routes return either `{ error: string }` or
 * `{ error: { message, code } }` (withErrorHandling); some legacy routes use
 * `{ message }`. Non-JSON bodies fall back to `fallback`.
 */
export async function readApiErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string | { message?: string };
    message?: string;
  } | null;
  if (typeof body?.error === 'string') return body.error;
  return body?.error?.message ?? body?.message ?? fallback;
}
