/**
 * Run `task` over `items` with at most `concurrency` tasks in flight and
 * resolve only after every item has been processed.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `--workers must be a positive integer, received ${concurrency}`
    );
  }
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++] as T;
        await task(item);
      }
    }
  );
  await Promise.all(runners);
}
