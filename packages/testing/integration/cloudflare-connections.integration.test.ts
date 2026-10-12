import { describe, expect, test } from 'bun:test';
import { db } from '../../db/src/db';
import { withRequestResources } from '../../shared/src/server/request-scope';

const run =
  process.env.RUN_CLOUDFLARE_CONNECTION_TESTS === '1'
    ? describe
    : describe.skip;
run('request-scoped PostgreSQL connections', () => {
  test('overlapping requests keep separate backends and clean up after streaming', async () => {
    const deferred: Promise<unknown>[] = [];
    let ready = () => {};
    const firstReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let release = () => {};
    const secondReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstPid = 0;
    let secondPid = 0;
    const pid = async () => {
      const rows = await db.$queryRaw<{
        pid: number;
      }>`SELECT pg_backend_pid() AS pid`;
      return rows[0]!.pid;
    };
    const first = withRequestResources(
      async () => {
        firstPid = await pid();
        ready();
        await secondReady;
        expect(await pid()).toBe(firstPid);
        return new Response(String(firstPid));
      },
      (promise) => deferred.push(promise)
    );
    await firstReady;
    const second = withRequestResources(
      async () => {
        secondPid = await pid();
        expect(secondPid).not.toBe(firstPid);
        release();
        return new Response(String(secondPid));
      },
      (promise) => deferred.push(promise)
    );
    const responses = await Promise.all([first, second]);
    expect(await responses[0]!.text()).toBe(String(firstPid));
    expect(await responses[1]!.text()).toBe(String(secondPid));
    await Promise.all(deferred);
    await withRequestResources(
      async () => {
        expect(await pid()).not.toBe(firstPid);
        expect(await pid()).not.toBe(secondPid);
        return new Response(null);
      },
      (promise) => deferred.push(promise)
    );
    await Promise.all(deferred);
  });
});
