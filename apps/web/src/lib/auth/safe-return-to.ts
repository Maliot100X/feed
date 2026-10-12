/**
 * Return `value` as a same-origin path (pathname + search + hash), or
 * `fallback` for anything that could navigate off-site.
 *
 * URLSearchParams already decodes the value; never decode it a second time.
 */
export function safeReturnTo(value: string | null, fallback = '/'): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return fallback;
  // Browsers normalize backslashes and remove control characters in URLs.
  if (/[\\\u0000- \u007f]/.test(value)) return fallback;
  const origin = 'https://callback.invalid';
  const destination = new URL(value, origin);
  if (destination.origin !== origin) return fallback;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
