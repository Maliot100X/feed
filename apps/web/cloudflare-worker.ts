import type {
  ExecutionContext,
  Hyperdrive,
  R2Bucket,
} from '@cloudflare/workers-types';
import { withRequestResources } from '@feed/shared/server/request-scope';
import { ensureRedisReady } from '../../packages/api/src/redis/client';
// OpenNext generates this module during build.
// @ts-ignore generated module
import handler from './.open-next/worker.js';

interface FeedCloudflareEnv {
  UPLOADS: R2Bucket;
  /** Pooled, TLS-verified route to Railway PostgreSQL. */
  HYPERDRIVE: Hyperdrive;
  DEPLOYMENT_ENV: string;
  COMMIT_SHA?: string;
}

export default {
  async fetch(request: Request, env: FeedCloudflareEnv, ctx: ExecutionContext) {
    // packages/db reads DATABASE_URL; the binding's local endpoint is the only database route.
    process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
    const url = new URL(request.url);
    if (url.pathname === '/__deployment') {
      return Response.json(
        {
          platform: 'cloudflare',
          environment: env.DEPLOYMENT_ENV,
          commit: env.COMMIT_SHA,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (url.pathname.startsWith('/media/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }
      let key: string;
      try {
        key = decodeURIComponent(url.pathname.slice('/media/'.length));
      } catch {
        return new Response('Invalid object key', { status: 400 });
      }
      if (
        !key ||
        key.split('/').some((part) => part === '..' || part === '.')
      ) {
        return new Response('Invalid object key', { status: 400 });
      }
      const object = await env.UPLOADS.get(key);
      if (!object) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('ETag', object.httpEtag);
      headers.set('X-Content-Type-Options', 'nosniff');
      // Uploaded documents/SVG must not execute scripts with the application origin.
      headers.set(
        'Content-Security-Policy',
        "sandbox; default-src 'none'; style-src 'unsafe-inline'"
      );
      headers.set('Cross-Origin-Resource-Policy', 'same-site');
      headers.set('Content-Length', String(object.size));
      if (request.headers.get('If-None-Match') === object.httpEtag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(
        request.method === 'HEAD'
          ? null
          : (object.body as unknown as ReadableStream<Uint8Array>),
        { headers }
      );
    }
    return withRequestResources(
      async (waitUntil) => {
        await ensureRedisReady();
        return handler.fetch(request, env, {
          waitUntil,
          passThroughOnException: () => ctx.passThroughOnException(),
          props: ctx.props,
        });
      },
      (promise) => ctx.waitUntil(promise)
    );
  },
};
