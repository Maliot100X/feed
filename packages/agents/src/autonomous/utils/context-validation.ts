/** Reject missing/corrupt financial context before it reaches a decision prompt. */
export function requireContextNumber(
  value: string | number | null | undefined,
  field: string,
  minimum = Number.NEGATIVE_INFINITY
): number {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    throw new Error(`Missing required agent context: ${field}`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new Error(`Invalid required agent context: ${field}`);
  }
  return number;
}
