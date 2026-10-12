import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestScope {
  waitUntil?: (promise: Promise<unknown>) => void;
  resources: Map<string, object>;
  cleanup: Array<() => Promise<void>>;
}

// The custom Worker and Next server are bundled separately. Share their scope.
const globalScope = globalThis as typeof globalThis & {
  __feedRequestScope?: AsyncLocalStorage<RequestScope>;
};
const storage = (globalScope.__feedRequestScope ??=
  new AsyncLocalStorage<RequestScope>());

export function requestResource<T extends object>(
  key: string,
  create: () => T,
  cleanup?: (resource: T) => Promise<void>
): T | undefined {
  const scope = storage.getStore();
  if (!scope) return undefined;
  const existing = scope.resources.get(key);
  if (existing) return existing as T;
  const resource = create();
  scope.resources.set(key, resource);
  if (cleanup) scope.cleanup.push(() => cleanup(resource));
  return resource;
}

/** Keep socket clients alive through streaming and deferred request work only. */
export async function withRequestResources(
  handle: (waitUntil: (promise: Promise<unknown>) => void) => Promise<Response>,
  waitUntil: (promise: Promise<unknown>) => void
): Promise<Response> {
  const scope: RequestScope = { resources: new Map(), cleanup: [] };
  return storage.run(scope, async () => {
    const deferred: Promise<unknown>[] = [];
    const collect = (promise: Promise<unknown>) => {
      deferred.push(promise);
      waitUntil(promise);
    };
    scope.waitUntil = collect;
    const cleanup = async () => {
      // Tasks may register more tasks while running.
      let completed = 0;
      while (completed < deferred.length) {
        const pending = deferred.slice(completed);
        completed = deferred.length;
        await Promise.allSettled(pending);
      }
      await Promise.all(scope.cleanup.map((close) => close()));
    };
    let response: Response;
    try {
      response = await handle(collect);
    } catch (error) {
      waitUntil(cleanup());
      throw error;
    }
    if (!response.body) {
      waitUntil(cleanup());
      return response;
    }
    const reader = response.body.getReader();
    let closed = false;
    const finish = () => {
      if (!closed) {
        closed = true;
        waitUntil(cleanup());
      }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await storage.run(scope, () => reader.read());
          if (result.done) {
            controller.close();
            finish();
          } else controller.enqueue(result.value);
        } catch (error) {
          controller.error(error);
          finish();
        }
      },
      async cancel(reason) {
        try {
          await storage.run(scope, () => reader.cancel(reason));
        } finally {
          finish();
        }
      },
    });
    return new Response(body, response);
  });
}

/** Register existing background work with the Worker request lifecycle. */
export function runInBackground(promise: Promise<unknown>): void {
  storage.getStore()?.waitUntil?.(promise);
}
