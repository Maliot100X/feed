import { z } from 'zod';
import {
  requiresRedis,
  SHARED_STATE_BACKENDS,
  selectedStateBackends,
} from '../../packages/api/src/redis/shared-state-health';

export function validateSharedStateDeployment(
  vars: Record<string, string>,
  secrets: Record<string, string>
): void {
  for (const { flag } of SHARED_STATE_BACKENDS) {
    if (Object.hasOwn(secrets, flag))
      throw new Error(`${flag} belongs in Wrangler vars, not runtime secrets`);
  }
  if (requiresRedis(vars) && !secrets.REDIS_URL)
    throw new Error(
      'REDIS_URL is required while a shared-state backend selects Redis'
    );
}

export function verifySharedStateDeployment(
  body: unknown,
  vars: Record<string, string>,
  paused: boolean
): void {
  const result = z
    .object({
      healthy: z.literal(true),
      paused: z.boolean(),
      backends: z.array(
        z.object({
          name: z.string(),
          provider: z.enum(['cloudflare', 'redis']),
          healthy: z.literal(true),
        })
      ),
    })
    .parse(body);
  const expected = selectedStateBackends(vars)
    .filter((backend) => backend.provider === 'cloudflare')
    .map((backend) => `${backend.binding}:cloudflare`);
  if (requiresRedis(vars)) expected.push('redis:redis');
  const actual = result.backends.map(
    (backend) => `${backend.name}:${backend.provider}`
  );
  if (
    result.paused !== paused ||
    JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())
  )
    throw new Error(
      'Live shared-state configuration does not match the selected deployment'
    );
}
