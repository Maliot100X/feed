/**
 * Entity Types for @feed/agents
 *
 * Types for entities that can be mentioned in messages
 */

/**
 * Company/Organization entity
 */
export interface CompanyEntity {
  id: string;
  name: string;
  ticker?: string | null;
  description?: string;
  bio?: string;
  currentPrice?: number | string | null;
  priceChangePercentage?: number | null;
  volume24h?: number | string;
  imageUrl?: string | null;
}

/**
 * User entity
 */
export interface UserEntity {
  id: string;
  username: string;
  displayName?: string | null;
  bio?: string | null;
  isAgent?: boolean;
  reputationPoints?: number | null;
}

/**
 * Entity mention result, discriminated by `type`.
 */
export type EntityMention =
  | { type: 'company'; data: CompanyEntity }
  | { type: 'user'; data: UserEntity };
