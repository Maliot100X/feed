import {
  requiresRedis,
  SHARED_STATE_BACKENDS,
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
