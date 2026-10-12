import { describe, expect, test } from 'bun:test';
import {
  requestResource,
  withRequestResources,
} from '../../shared/src/server/request-scope';

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Cloudflare request resources', () => {
  test('concurrent requests never reuse a socket resource', async () => {
    const firstReady = deferred();
    const secondReady = deferred();
    const tasks: Promise<unknown>[] = [];
    const closed: number[] = [];
    const resource = (id: number) =>
      requestResource(
        'socket',
        () => ({ id }),
        async ({ id }) => {
          closed.push(id);
        }
      );
    const first = withRequestResources(
      async () => {
        expect(resource(1)?.id).toBe(1);
        firstReady.release();
        await secondReady.promise;
        expect(resource(999)?.id).toBe(1);
        return new Response(null);
      },
      (task) => tasks.push(task)
    );
    await firstReady.promise;
    const second = withRequestResources(
      async () => {
        expect(resource(2)?.id).toBe(2);
        secondReady.release();
        return new Response(null);
      },
      (task) => tasks.push(task)
    );
    await Promise.all([first, second]);
    await Promise.all(tasks);
    expect(closed.sort()).toEqual([1, 2]);
    expect(resource(3)).toBeUndefined();
  });

  test('cleanup waits for both the response stream and deferred work', async () => {
    const pending = deferred();
    const tasks: Promise<unknown>[] = [];
    let closed = false;
    const response = await withRequestResources(
      async (waitUntil) => {
        requestResource(
          'socket',
          () => ({}),
          async () => {
            closed = true;
          }
        );
        waitUntil(pending.promise);
        return new Response('streamed result');
      },
      (task) => tasks.push(task)
    );
    expect(closed).toBe(false);
    expect(await response.text()).toBe('streamed result');
    expect(closed).toBe(false);
    pending.release();
    await Promise.all(tasks);
    expect(closed).toBe(true);
  });

  test('failed handlers release resources without swallowing the failure', async () => {
    const tasks: Promise<unknown>[] = [];
    let closed = false;
    await expect(
      withRequestResources(
        async () => {
          requestResource(
            'socket',
            () => ({}),
            async () => {
              closed = true;
            }
          );
          throw new Error('handler failed');
        },
        (task) => tasks.push(task)
      )
    ).rejects.toThrow('handler failed');
    await Promise.all(tasks);
    expect(closed).toBe(true);
  });
});
