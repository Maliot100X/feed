import { getRequestResource } from '@feed/shared/server/request-scope';
import { z } from 'zod';

export const SHARED_STATE_HEALTH_RESOURCE = 'shared-state-health';
export const SHARED_STATE_BACKENDS = [
  { flag: 'RATE_LIMIT_BACKEND', binding: 'RATE_LIMITS', object: 'shared' },
  {
    flag: 'DEVICE_REGISTRY_BACKEND',
    binding: 'DEVICES',
    object: 'device-registry-v1',
  },
  {
    flag: 'PAYMENT_STORAGE_BACKEND',
    binding: 'PAYMENTS',
    object: 'payment-storage-v1',
  },
  {
    flag: 'API_KEY_USAGE_BACKEND',
    binding: 'API_KEY_USAGE',
    object: 'api-key-usage-v1',
  },
  {
    flag: 'ORG_COORDINATION_BACKEND',
    binding: 'ORG_COORDINATION',
    object: 'org-coordination-v1',
  },
  {
    flag: 'ALERT_RESERVATIONS_BACKEND',
    binding: 'ALERT_RESERVATIONS',
    object: 'alert-reservations-v1',
  },
  { flag: 'TASK_STORAGE_BACKEND', binding: 'TASKS', object: 'task-storage-v1' },
  { flag: 'CACHE_BACKEND', binding: 'CACHE', object: 'cache-v1' },
  { flag: 'STREAMS_BACKEND', binding: 'STREAMS', object: 'streams-v1' },
] as const;
type BackendFlag = (typeof SHARED_STATE_BACKENDS)[number]['flag'];
type Configuration =
  | Partial<Record<BackendFlag, string>>
  | Readonly<Record<string, string | undefined>>;

export function selectedStateBackends(env: Configuration) {
  return SHARED_STATE_BACKENDS.map((backend) => {
    const provider = env[backend.flag] ?? 'redis';
    if (provider !== 'redis' && provider !== 'cloudflare')
      throw new Error(`Unsupported shared state backend: ${backend.flag}`);
    return { ...backend, provider };
  });
}
export function requiresRedis(env: Configuration): boolean {
  return selectedStateBackends(env).some(
    (backend) => backend.provider === 'redis'
  );
}
export interface SharedStateHealth {
  healthy: boolean;
  backends: Array<{
    name: string;
    provider: 'redis' | 'cloudflare';
    healthy: boolean;
  }>;
}
export interface SharedStateProbe {
  name: string;
  provider: 'redis' | 'cloudflare';
  check(): Promise<boolean>;
}
export function createSharedStateHealth(probes: SharedStateProbe[]) {
  if (probes.length === 0) throw new Error('Shared state probes are required');
  return {
    async check(): Promise<SharedStateHealth> {
      const results = await Promise.allSettled(
        probes.map((probe) => probe.check())
      );
      const backends = probes.map((probe, index) => {
        const result = results[index]!;
        return {
          name: probe.name,
          provider: probe.provider,
          healthy: result.status === 'fulfilled' && result.value === true,
        };
      });
      return {
        healthy: backends.every((backend) => backend.healthy),
        backends,
      };
    },
  };
}
export async function checkCloudflareState(response: {
  ok: boolean;
  body: { cancel(): Promise<void> } | null;
  json(): Promise<unknown>;
}): Promise<boolean> {
  if (!response.ok) {
    await response.body?.cancel();
    return false;
  }
  return z.object({ healthy: z.literal(true) }).safeParse(await response.json())
    .success;
}
export async function getSharedStateHealth(
  redisHealthy: boolean
): Promise<SharedStateHealth> {
  const resource = getRequestResource<
    ReturnType<typeof createSharedStateHealth>
  >(SHARED_STATE_HEALTH_RESOURCE);
  if (resource) return resource.check();
  const selected = selectedStateBackends(process.env);
  const backends: SharedStateHealth['backends'] = selected
    .filter((backend) => backend.provider === 'cloudflare')
    .map((backend) => ({
      name: backend.binding,
      provider: 'cloudflare',
      healthy: false,
    }));
  if (requiresRedis(process.env))
    backends.push({ name: 'redis', provider: 'redis', healthy: redisHealthy });
  return { healthy: backends.every((backend) => backend.healthy), backends };
}
