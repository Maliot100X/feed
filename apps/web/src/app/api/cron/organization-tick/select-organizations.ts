import { secureRandom } from '@feed/engine';
import { logger } from '@feed/shared';

/**
 * Organization type definitions for different posting behaviors.
 * Each type has distinct posting patterns that mirror real-world counterparts.
 */
export type OrgType =
  | 'media'
  | 'company'
  | 'vc'
  | 'government'
  | 'organization'
  | 'financial';

/**
 * Posting frequency weights for each organization type.
 * Higher weight = more likely to be selected for posting.
 *
 * Rationale (mirrors real-world social media patterns):
 * - media (1.5): News outlets post constantly, breaking news 24/7
 * - company (1.2): Tech companies active on social, product updates, PR
 * - vc (1.0): VCs post thought leadership but less frequently than companies
 * - government (0.6): Official accounts post less, more measured
 * - organization (0.8): Foundations active but not as much as companies
 * - financial (0.7): Institutions post market commentary, less frequent
 */
export const ORG_TYPE_WEIGHTS: Record<OrgType, number> = {
  media: 1.5,
  company: 1.2,
  vc: 1.0,
  organization: 0.8,
  financial: 0.7,
  government: 0.6,
};

function typeWeight(type: string | undefined): number {
  return ORG_TYPE_WEIGHTS[(type || 'media') as OrgType] || 1;
}

/**
 * Pick one index from `weights` proportionally to its weight.
 * `random` must return a value in [0, 1).
 */
function pickWeightedIndex(weights: number[], random: () => number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = random() * total;
  for (let i = 0; i < weights.length; i++) {
    remaining -= weights[i]!;
    if (remaining < 0) return i;
  }
  // Floating-point rounding can leave a tiny positive remainder.
  return weights.length - 1;
}

/**
 * Select organizations for this tick using weighted stratified sampling.
 *
 * Strategy:
 * 1. Group orgs by type.
 * 2. Draw distinct types by weighted sampling without replacement and take
 *    one random org from each, so every positive-weight type has a chance
 *    to appear (higher weight = more likely) instead of the lowest-weight
 *    types being starved whenever higher types are eligible.
 * 3. Fill remaining slots with weighted random selection over the rest.
 */
export function selectWeightedOrganizations<
  T extends { id: string; type?: string; name: string },
>(orgs: T[], count: number, random: () => number = secureRandom): T[] {
  if (orgs.length <= count) return [...orgs];

  const byType = new Map<string, T[]>();
  for (const org of orgs) {
    const type = org.type || 'media';
    const list = byType.get(type) || [];
    list.push(org);
    byType.set(type, list);
  }

  const selected: T[] = [];
  const selectedIds = new Set<string>();

  // Phase 1: one org per type, types drawn by weight without replacement.
  const types = [...byType.entries()];
  while (selected.length < count && types.length > 0) {
    const typeIdx = pickWeightedIndex(
      types.map(([type]) => typeWeight(type)),
      random
    );
    const [, typeOrgs] = types.splice(typeIdx, 1)[0]!;
    const org = typeOrgs[Math.floor(random() * typeOrgs.length)]!;
    selected.push(org);
    selectedIds.add(org.id);
  }

  // Phase 2: fill remaining slots with weighted random selection.
  const pool = orgs.filter((org) => !selectedIds.has(org.id));
  while (selected.length < count && pool.length > 0) {
    const idx = pickWeightedIndex(
      pool.map((org) => typeWeight(org.type)),
      random
    );
    const [org] = pool.splice(idx, 1);
    selected.push(org!);
    selectedIds.add(org!.id);
  }

  const typeCounts: Record<string, number> = {};
  for (const org of selected) {
    const type = org.type || 'media';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  logger.debug(
    'Weighted org selection',
    { count: selected.length, distribution: typeCounts },
    'OrganizationTick'
  );

  return selected;
}
