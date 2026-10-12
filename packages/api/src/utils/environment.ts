/**
 * Deployment Environment Utilities
 *
 * Utilities for determining the current deployment environment
 * based on DEPLOYMENT_ENV and Node.js environment variables.
 */

export type DeploymentEnvironment = 'production' | 'staging' | 'development';

/**
 * Get current deployment environment
 *
 * Determines environment based on:
 * 1. DEPLOYMENT_ENV (production, staging)
 * 2. NODE_ENV as fallback
 *
 * @returns The current deployment environment
 */
export function getDeploymentEnvironment(): DeploymentEnvironment {
  if (process.env.DEPLOYMENT_ENV === 'staging') return 'staging';
  if (process.env.DEPLOYMENT_ENV === 'production') return 'production';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}
