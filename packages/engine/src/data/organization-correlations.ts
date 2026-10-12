/**
 * Organization Correlations - Cross-market relationship data
 *
 * Defines how events affecting one organization should cascade to related organizations.
 * This enables realistic market behavior where:
 * - Supplier problems affect downstream companies
 * - Competitor scandals benefit rivals
 * - Partner success creates positive spillover
 *
 * Relationships are derived from:
 * 1. Real-world supply chain relationships (parody versions)
 * 2. Industry competition dynamics
 * 3. Strategic partnerships
 * 4. Shared executive connections (via actor affiliations)
 *
 * @example
 * When TeslAI has a -10% event:
 * - NVIDAI (supplier) gets -3% (0.3 multiplier, same direction)
 * - AIPPLE (competitor) gets +1.5% (-0.15 multiplier, inverse)
 */

/**
 * Relationship type between organizations
 */
export type OrganizationRelationType =
  | 'supplier' // Primary supplies to Related
  | 'customer' // Primary buys from Related
  | 'competitor' // Direct competitors
  | 'partner' // Strategic partners
  | 'subsidiary' // Related is owned by Primary
  | 'investor' // Primary invests in Related
  | 'shared_executive'; // Share C-level executives (derived from actor affiliations)

/**
 * Market correlation definition
 */
export interface MarketCorrelation {
  /** Primary organization ID (event source) */
  primary: string;
  /** Related organization ID (cascade target) */
  related: string;
  /** Type of relationship */
  relationship: OrganizationRelationType;
  /**
   * Effect multiplier:
   * - Positive: Same direction (supplier problems hurt customers)
   * - Negative: Inverse direction (competitor scandal helps rivals)
   * - Magnitude: Percentage of primary effect (0.3 = 30%)
   */
  multiplier: number;
  /** Optional description for debugging */
  description?: string;
}

/**
 * Static correlation data based on real-world relationships
 *
 * Note: These are parody organization IDs from the default pack
 * (packages/pack-default/src/organizations)
 */
export const correlations: MarketCorrelation[] = [
  // ============================================================================
  // AI Infrastructure Chain
  // ============================================================================
  // NVIDAI is the GPU supplier to all major AI companies
  {
    primary: 'nvidai',
    related: 'openagi',
    relationship: 'supplier',
    multiplier: 0.25,
    description: 'NVIDAI GPUs power OpenAGI training',
  },
  {
    primary: 'nvidai',
    related: 'aitropic',
    relationship: 'supplier',
    multiplier: 0.25,
    description: 'NVIDAI GPUs power AItropic training',
  },
  {
    primary: 'nvidai',
    related: 'metai',
    relationship: 'supplier',
    multiplier: 0.2,
    description: 'NVIDAI GPUs power MetAI LLaMA training',
  },
  {
    primary: 'nvidai',
    related: 'aiphabet',
    relationship: 'supplier',
    multiplier: 0.15,
    description: 'NVIDAI GPUs used by AIphabet for AI',
  },
  {
    primary: 'nvidai',
    related: 'teslai',
    relationship: 'supplier',
    multiplier: 0.2,
    description: 'NVIDAI chips in TeslAI FSD',
  },

  // ============================================================================
  // AI Lab Competition
  // ============================================================================
  {
    primary: 'openagi',
    related: 'aitropic',
    relationship: 'competitor',
    multiplier: -0.15,
    description: 'OpenAGI and AItropic compete in frontier AI',
  },
  {
    primary: 'openagi',
    related: 'deepmaind',
    relationship: 'competitor',
    multiplier: -0.12,
    description: 'OpenAGI and DeepMAInd compete in AGI research',
  },
  {
    primary: 'aitropic',
    related: 'openagi',
    relationship: 'competitor',
    multiplier: -0.15,
    description: 'AItropic and OpenAGI compete in frontier AI',
  },

  // ============================================================================
  // OpenAGI - MaicroSoft Partnership
  // ============================================================================
  {
    primary: 'openagi',
    related: 'maicrosoft',
    relationship: 'partner',
    multiplier: 0.3,
    description: 'MaicroSoft is OpenAGI primary investor and partner',
  },
  {
    primary: 'maicrosoft',
    related: 'openagi',
    relationship: 'investor',
    multiplier: 0.25,
    description: 'MaicroSoft heavily invested in OpenAGI',
  },

  // ============================================================================
  // Big Tech Competition
  // ============================================================================
  {
    primary: 'aiphabet',
    related: 'metai',
    relationship: 'competitor',
    multiplier: -0.1,
    description: 'AIphabet and MetAI compete in ads',
  },
  {
    primary: 'metai',
    related: 'aiphabet',
    relationship: 'competitor',
    multiplier: -0.1,
    description: 'MetAI and AIphabet compete in ads',
  },
  {
    primary: 'aipple',
    related: 'aiphabet',
    relationship: 'competitor',
    multiplier: -0.08,
    description: 'AIPple and AIphabet compete in mobile',
  },
  {
    primary: 'aipple',
    related: 'maicrosoft',
    relationship: 'competitor',
    multiplier: -0.05,
    description: 'AIPple and MaicroSoft compete in hardware',
  },

  // ============================================================================
  // AIlon Musk Empire (shared executive connections)
  // ============================================================================
  {
    primary: 'teslai',
    related: 'aix',
    relationship: 'shared_executive',
    multiplier: 0.2,
    description: 'AIlon Musk runs both TeslAI and AIX',
  },
  {
    primary: 'teslai',
    related: 'spaicex',
    relationship: 'shared_executive',
    multiplier: 0.15,
    description: 'AIlon Musk runs both TeslAI and SpAIceX',
  },
  {
    primary: 'teslai',
    related: 'neurailink',
    relationship: 'shared_executive',
    multiplier: 0.15,
    description: 'AIlon Musk runs both TeslAI and NeurAIlink',
  },
  {
    primary: 'aix',
    related: 'teslai',
    relationship: 'shared_executive',
    multiplier: 0.2,
    description: 'AIX and TeslAI share AIlon Musk',
  },
  {
    primary: 'spaicex',
    related: 'teslai',
    relationship: 'shared_executive',
    multiplier: 0.15,
    description: 'SpAIceX and TeslAI share AIlon Musk',
  },

  // ============================================================================
  // Electric Vehicle Competition
  // ============================================================================
  {
    primary: 'teslai',
    related: 'aipple',
    relationship: 'competitor',
    multiplier: -0.08,
    description: 'TeslAI and AIPple compete in EV market',
  },

  // ============================================================================
  // Cloud Provider Competition
  // ============================================================================
  {
    primary: 'aimazon',
    related: 'maicrosoft',
    relationship: 'competitor',
    multiplier: -0.1,
    description: 'AImazon AWS vs MaicroSoft Azure',
  },
  {
    primary: 'aimazon',
    related: 'aiphabet',
    relationship: 'competitor',
    multiplier: -0.1,
    description: 'AImazon AWS vs AIphabet Cloud',
  },
  {
    primary: 'maicrosoft',
    related: 'aimazon',
    relationship: 'competitor',
    multiplier: -0.1,
    description: 'MaicroSoft Azure vs AImazon AWS',
  },

  // ============================================================================
  // Crypto Ecosystem
  // ============================================================================
  {
    primary: 'coinbaise',
    related: 'ethereum-foundaition',
    relationship: 'partner',
    multiplier: 0.15,
    description: 'CoinbAIse major ETH platform',
  },
  {
    primary: 'straitegy',
    related: 'coinbaise',
    relationship: 'partner',
    multiplier: 0.12,
    description: 'StrAItegy and CoinbAIse in crypto space',
  },

  // ============================================================================
  // VC - Portfolio Relationships
  // ============================================================================
  {
    primary: 'ai16z',
    related: 'openagi',
    relationship: 'investor',
    multiplier: 0.1,
    description: 'AI16Z is OpenAGI investor',
  },
  {
    primary: 'sequoai-capital',
    related: 'openagi',
    relationship: 'investor',
    multiplier: 0.1,
    description: 'SequoAI is OpenAGI investor',
  },

  // ============================================================================
  // Defense Tech
  // ============================================================================
  {
    primary: 'palaintir',
    related: 'ainduril',
    relationship: 'competitor',
    multiplier: -0.12,
    description: 'PalAIntir and AInduril compete in defense AI',
  },
  {
    primary: 'ainduril',
    related: 'palaintir',
    relationship: 'competitor',
    multiplier: -0.12,
    description: 'AInduril and PalAIntir compete in defense AI',
  },

  // ============================================================================
  // Media Competition
  // ============================================================================
  {
    primary: 'faix-news',
    related: 'msainbc',
    relationship: 'competitor',
    multiplier: -0.1,
    description: 'FAIx News and AINBC compete for viewers',
  },
  {
    primary: 'the-new-york-taimes',
    related: 'wall-street-journai',
    relationship: 'competitor',
    multiplier: -0.08,
    description: 'NYT and WSJ compete for readers',
  },
];

/**
 * Get correlations for a primary organization
 */
export function getCorrelationsForOrg(orgId: string): MarketCorrelation[] {
  return correlations.filter((c) => c.primary === orgId);
}

/**
 * Get all organizations that would be affected by an event at the given org
 */
export function getAffectedOrgs(primaryOrgId: string): Array<{
  orgId: string;
  multiplier: number;
  relationship: OrganizationRelationType;
}> {
  return correlations
    .filter((c) => c.primary === primaryOrgId)
    .map((c) => ({
      orgId: c.related,
      multiplier: c.multiplier,
      relationship: c.relationship,
    }));
}

/**
 * Check if two organizations are correlated
 */
export function areCorrelated(orgId1: string, orgId2: string): boolean {
  return correlations.some(
    (c) =>
      (c.primary === orgId1 && c.related === orgId2) ||
      (c.primary === orgId2 && c.related === orgId1)
  );
}

/**
 * Get the correlation multiplier between two organizations
 * Returns 0 if no correlation exists
 */
export function getCorrelationMultiplier(
  primaryOrgId: string,
  relatedOrgId: string
): number {
  const correlation = correlations.find(
    (c) => c.primary === primaryOrgId && c.related === relatedOrgId
  );
  return correlation?.multiplier ?? 0;
}
