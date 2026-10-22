import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';
import { getRedisClient } from '../redis/client';

export const DEVICE_REGISTRY_RESOURCE = 'cloudflare-device-registry';
const success = z.object({ success: z.literal(true) });
type Registration = {
  userId: string;
  platform: 'ios' | 'android';
  token: string;
};
interface Registry {
  register(input: Registration): Promise<void>;
  remove(userId: string): Promise<void>;
}
interface StateResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}

export function createCloudflareDeviceRegistry(
  send: (body: string) => Promise<StateResponse>
): Registry {
  async function call(body: object): Promise<void> {
    const response = await send(JSON.stringify(body));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Cloudflare device operation failed (HTTP ${response.status})`
      );
    }
    success.parse(await response.json());
  }
  return {
    register: (input) => call({ operation: 'register', ...input }),
    remove: (userId) => call({ operation: 'remove', userId }),
  };
}

export function getDeviceRegistry(): Registry | null {
  const cloudflare = getRequestResource<Registry>(DEVICE_REGISTRY_RESOURCE);
  if (cloudflare) return cloudflare;
  if (process.env.DEVICE_REGISTRY_BACKEND === 'cloudflare') return null;
  if (
    process.env.DEVICE_REGISTRY_BACKEND &&
    process.env.DEVICE_REGISTRY_BACKEND !== 'redis'
  ) {
    throw new Error('Unsupported device registry backend');
  }
  const redis = getRedisClient();
  if (!redis) return null;
  return {
    async register({ userId, platform, token }) {
      const key = `push:device:${userId}`;
      await redis.hset(
        key,
        token,
        JSON.stringify({ platform, token, updatedAt: Date.now() })
      );
      await redis.expire(key, 90 * 24 * 60 * 60);
    },
    async remove(userId) {
      await redis.del(`push:device:${userId}`);
    },
  };
}
