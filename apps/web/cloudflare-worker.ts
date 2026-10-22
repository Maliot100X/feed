import {
  API_KEY_USAGE_RESOURCE,
  createCloudflareApiKeyUsage,
} from '../../packages/api/src/utils/cloudflare-api-key-usage';

export { FeedApiKeyUsage } from '../../packages/api/src/utils/cloudflare-api-key-usage-object';

import {
  createCloudflarePaymentStorage,
  PAYMENT_STORAGE_RESOURCE,
} from '../../packages/a2a/src/payments/cloudflare-backend';

export { FeedPayments } from '../../packages/a2a/src/payments/cloudflare-object';

import type {
  DurableObjectNamespace,
  ExecutionContext,
  Hyperdrive,
  R2Bucket,
  AbortSignal as WorkerAbortSignal,
} from '@cloudflare/workers-types';
import {
  requestResource,
  withRequestResources,
} from '@feed/shared/server/request-scope';
import {
  createCloudflareRateLimitBackend,
  RATE_LIMIT_RESOURCE,
} from '../../packages/api/src/rate-limiting/cloudflare-backend';

export { FeedDevices } from '../../packages/api/src/notifications/cloudflare-object';
export { FeedRateLimits } from '../../packages/api/src/rate-limiting/cloudflare-object';

import {
  createCloudflareDeviceRegistry,
  DEVICE_REGISTRY_RESOURCE,
} from '../../packages/api/src/notifications/device-registry';

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
  RATE_LIMIT_BACKEND?: string;
  RATE_LIMITS: DurableObjectNamespace;
  DEVICE_REGISTRY_BACKEND?: string;
  DEVICES: DurableObjectNamespace;
  PAYMENT_STORAGE_BACKEND?: string;
  PAYMENTS: DurableObjectNamespace;
  API_KEY_USAGE_BACKEND?: string;
  API_KEY_USAGE: DurableObjectNamespace;
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
        if (env.RATE_LIMIT_BACKEND === 'cloudflare') {
          const stub = env.RATE_LIMITS.get(
            env.RATE_LIMITS.idFromName('shared')
          );
          requestResource(RATE_LIMIT_RESOURCE, () =>
            createCloudflareRateLimitBackend((body) =>
              stub.fetch('https://rate-limit.internal/', {
                method: 'POST',
                // Both types describe the same Worker runtime signal.
                signal: request.signal as unknown as WorkerAbortSignal,
                headers: { 'content-type': 'application/json' },
                body,
              })
            )
          );
        } else if (
          env.RATE_LIMIT_BACKEND &&
          env.RATE_LIMIT_BACKEND !== 'redis'
        ) {
          throw new Error('Unsupported rate limit backend');
        }
        if (env.DEVICE_REGISTRY_BACKEND === 'cloudflare') {
          const stub = env.DEVICES.get(
            env.DEVICES.idFromName('device-registry-v1')
          );
          requestResource(DEVICE_REGISTRY_RESOURCE, () =>
            createCloudflareDeviceRegistry((body) =>
              stub.fetch('https://devices.internal/', {
                method: 'POST',
                signal: request.signal as unknown as WorkerAbortSignal,
                headers: { 'content-type': 'application/json' },
                body,
              })
            )
          );
        } else if (
          env.DEVICE_REGISTRY_BACKEND &&
          env.DEVICE_REGISTRY_BACKEND !== 'redis'
        ) {
          throw new Error('Unsupported device registry backend');
        }
        if (env.PAYMENT_STORAGE_BACKEND === 'cloudflare') {
          const stub = env.PAYMENTS.get(
            env.PAYMENTS.idFromName('payment-storage-v1')
          );
          requestResource(PAYMENT_STORAGE_RESOURCE, () =>
            createCloudflarePaymentStorage((body) =>
              stub.fetch('https://payments.internal/', {
                method: 'POST',
                signal: request.signal as unknown as WorkerAbortSignal,
                headers: { 'content-type': 'application/json' },
                body,
              })
            )
          );
        } else if (
          env.PAYMENT_STORAGE_BACKEND &&
          env.PAYMENT_STORAGE_BACKEND !== 'redis'
        ) {
          throw new Error('Unsupported payment storage backend');
        }
        if (env.API_KEY_USAGE_BACKEND === 'cloudflare') {
          const stub = env.API_KEY_USAGE.get(
            env.API_KEY_USAGE.idFromName('api-key-usage-v1')
          );
          requestResource(API_KEY_USAGE_RESOURCE, () =>
            createCloudflareApiKeyUsage((body) =>
              stub.fetch('https://api-key-usage.internal/', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body,
              })
            )
          );
        } else if (
          env.API_KEY_USAGE_BACKEND &&
          env.API_KEY_USAGE_BACKEND !== 'redis'
        ) {
          throw new Error('Unsupported API key usage backend');
        }
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
