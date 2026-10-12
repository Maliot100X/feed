/** The JSON-safe shape produced by {@link sanitizeForJson}. */
export type JsonSanitized<T> = T extends bigint
  ? string
  : T extends Date
    ? string
    : T extends ReadonlyArray<infer U>
      ? JsonSanitized<U>[]
      : T extends object
        ? { [K in keyof T]: JsonSanitized<T[K]> }
        : T;

/**
 * Convert a value into something `JSON.stringify` can serialize: bigints
 * become strings, Dates become ISO strings, and genuinely circular references
 * (an object/array that contains one of its own ancestors) become null.
 * Objects shared by several siblings are serialized each time they appear.
 */
export function sanitizeForJson<T>(value: T): JsonSanitized<T> {
  // Only ancestors on the current path count as cycles.
  const ancestors = new Set<object>();

  const visit = (input: unknown): unknown => {
    if (typeof input === 'bigint') {
      return input.toString();
    }

    if (input instanceof Date) {
      return input.toISOString();
    }

    if (input === null || typeof input !== 'object') {
      return input;
    }

    if (ancestors.has(input)) {
      return null;
    }
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        return input.map((item) => visit(item));
      }
      return Object.fromEntries(
        Object.entries(input).map(([key, nested]) => [key, visit(nested)])
      );
    } finally {
      ancestors.delete(input);
    }
  };

  return visit(value) as JsonSanitized<T>;
}
