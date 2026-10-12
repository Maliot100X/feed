import { StaticDataRegistry } from '@feed/engine';

export interface ResolvedPerpMarket {
  ticker: string;
  organizationId: string;
  name: string;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');

type PerpOrganization = ReturnType<
  typeof StaticDataRegistry.getAllOrganizations
>[number];

/**
 * Resolve a user-provided perp identifier (ticker/name/id) to a canonical ticker.
 * Accepts case-insensitive ticker symbols, organization IDs, parody names,
 * original names, and common handles.
 */
export function resolvePerpTicker(
  identifier?: string | null
): ResolvedPerpMarket | null {
  return resolvePerpTickerFrom(
    identifier,
    StaticDataRegistry.getAllOrganizations()
  );
}

/**
 * Pure resolver over an explicit organization list.
 *
 * Identifiers that normalize to an empty string (e.g. punctuation only) never
 * match. The prefix fallback only resolves when exactly one market matches;
 * ambiguous prefixes return null instead of an arbitrary market.
 */
export function resolvePerpTickerFrom(
  identifier: string | null | undefined,
  organizations: readonly PerpOrganization[]
): ResolvedPerpMarket | null {
  if (!identifier) return null;

  const trimmed = identifier.trim();
  const normalized = normalize(trimmed);
  if (!normalized) {
    return null;
  }

  const allOrgs = organizations.filter(
    (org) => org.ticker && org.type === 'company'
  );

  const lower = trimmed.toLowerCase();
  const normalizedEquals = (candidate: string | null | undefined) =>
    !!candidate && normalize(candidate) === normalized;

  const matchers: Array<(org: (typeof allOrgs)[number]) => boolean> = [
    (org) => org.ticker?.toLowerCase() === lower,
    (org) => org.id.toLowerCase() === lower,
    (org) => org.name.toLowerCase() === lower,
    (org) => org.originalName?.toLowerCase() === lower,
    (org) => org.originalHandle?.toLowerCase() === lower,
    (org) => normalizedEquals(org.ticker),
    (org) => normalizedEquals(org.id),
    (org) => normalizedEquals(org.name),
    (org) => normalizedEquals(org.originalName),
    (org) => normalizedEquals(org.originalHandle),
  ];

  for (const matcher of matchers) {
    const found = allOrgs.find(matcher);
    if (found?.ticker) {
      return {
        ticker: found.ticker,
        organizationId: found.id,
        name: found.name,
      };
    }
  }

  // Partial match fallback for longer identifiers (e.g., "tesla stock")
  if (normalized.length >= 3) {
    const matchesPrefix = (candidate: string | null | undefined) => {
      if (!candidate) return false;
      const normalizedCandidate = normalize(candidate);
      if (normalizedCandidate.length < 3) return false;
      return (
        normalizedCandidate.startsWith(normalized) ||
        normalized.startsWith(normalizedCandidate)
      );
    };

    // Only a UNIQUE prefix match is accepted: picking the first of several
    // candidates would route a trade to a guessed market.
    const partials = allOrgs.filter(
      (org) =>
        matchesPrefix(org.ticker) ||
        matchesPrefix(org.name) ||
        matchesPrefix(org.originalName)
    );

    const partial = partials.length === 1 ? partials[0] : undefined;
    if (partial?.ticker) {
      return {
        ticker: partial.ticker,
        organizationId: partial.id,
        name: partial.name,
      };
    }
  }

  return null;
}
