/**
 * Entity Mentions Provider
 * Detects and enriches mentions of users, companies, and stocks in messages
 * Uses regex to find mentions and provides context via A2A protocol
 */

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
  State,
} from '@elizaos/core';
import type { JsonValue } from '../../../types/common';
import type { EntityMention } from '../../../types/entities';
import type { FeedRuntime } from '../types';
import {
  organizationMentionsContextSchema,
  userMentionsContextSchema,
} from './context-contracts';

/**
 * Provider: Entity Mentions
 * Detects mentions of stocks, companies, and users in messages and provides their context
 */
export const entityMentionsProvider: Provider = {
  name: 'FEED_ENTITY_MENTIONS',
  description:
    'Detects and provides context for mentioned users, companies, and stocks in messages',

  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    const feedRuntime = runtime as FeedRuntime;

    // A2A is REQUIRED
    if (!feedRuntime.a2aClient?.isConnected()) {
      throw new Error(
        'A2A context unavailable: an active connection is required'
      );
    }

    const messageText = message.content.text || '';

    if (!messageText || messageText.length < 3) {
      return { text: '' };
    }

    // Find potential entity mentions using regex and look up via A2A
    const entities = await findEntityMentions(messageText, feedRuntime);

    if (entities.length === 0) {
      return { text: '' };
    }

    // Build context for each entity
    const entityContexts: string[] = [];
    const entityData: Array<{
      type: string;
      id: string;
      [key: string]: JsonValue;
    }> = [];

    for (const entity of entities) {
      if (entity.type === 'company') {
        const company = entity.data;

        const context = `📈 ${company.ticker || company.name}:
• Name: ${company.name}
• Type: Company
• Current Price: ${company.currentPrice == null ? 'not quoted' : `$${Number(company.currentPrice).toFixed(2)}`}
• Price Change: ${company.priceChangePercentage != null ? (company.priceChangePercentage >= 0 ? '+' : '') + company.priceChangePercentage.toFixed(2) + '%' : 'N/A'}${company.description ? `\n• About: ${company.description}` : ''}`;

        entityContexts.push(context);
        entityData.push({
          type: 'company',
          id: company.id,
          name: company.name,
          ticker: company.ticker ?? null,
          currentPrice:
            company.currentPrice == null ? null : Number(company.currentPrice),
          priceChangePercentage: company.priceChangePercentage ?? null,
          description: company.description ?? null,
        });
      } else {
        const user = entity.data;

        const context = `👤 ${user.displayName || user.username}:
• Username: @${user.username}
• Type: ${user.isAgent ? 'AI Agent' : 'User'}${user.reputationPoints != null ? `\n• Points: ${user.reputationPoints}` : ''}${user.bio ? `\n• Bio: ${user.bio}` : ''}`;

        entityContexts.push(context);
        entityData.push({
          type: 'user',
          id: user.id,
          username: user.username,
          displayName: user.displayName ?? null,
          isAgent: user.isAgent ?? false,
          reputationPoints: user.reputationPoints ?? null,
        });
      }
    }

    if (entityContexts.length === 0) {
      return { text: '' };
    }

    return {
      text: `[MENTIONED ENTITIES]\n${entityContexts.join('\n\n')}\n[/MENTIONED ENTITIES]`,
      data: {
        entities: entityData,
        count: entityData.length,
      },
    };
  },
};

/**
 * Find entity mentions in text and look them up via A2A protocol
 */
async function findEntityMentions(
  text: string,
  runtime: FeedRuntime
): Promise<EntityMention[]> {
  const results: EntityMention[] = [];

  // Extract potential entity names
  // 1. @username mentions (usernames may contain hyphens)
  const usernameMentions = text.match(/@([A-Za-z0-9_-]+)/g) || [];

  // 2. $TICKER mentions (canonical tickers can be longer than 5, e.g. OPENAGI)
  const tickerMentions = text.match(/\$([A-Z][A-Z0-9]{0,9})\b/g) || [];

  // 3. Quoted names or capitalized multi-word names
  const quotedNames = text.match(/"([^"]{2,50})"/g) || [];
  const capitalizedNames =
    text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)+)\b/g) || [];

  // Look up usernames via A2A
  if (usernameMentions.length > 0 && runtime.a2aClient) {
    // Normalize and deduplicate before issuing any lookup requests.
    const usernames = [
      ...new Set(usernameMentions.map((m) => m.substring(1).toLowerCase())),
    ];

    // Search for each username via A2A
    for (const username of usernames.slice(0, 10)) {
      const searchResult = await runtime.a2aClient.searchUsers(username, 5);
      const { users } = userMentionsContextSchema.parse(searchResult);

      // Find exact username match
      const matchedUser = users.find(
        (u) => u.username?.toLowerCase() === username
      );
      if (matchedUser?.username) {
        results.push({
          type: 'user' as const,
          data: {
            id: matchedUser.id,
            username: matchedUser.username,
            displayName: matchedUser.displayName || null,
            bio: matchedUser.bio || null,
            isAgent: matchedUser.isAgent,
            reputationPoints: matchedUser.reputationPoints,
          },
        });
      }
    }
  }

  // Look up organizations via A2A
  if (
    (tickerMentions.length > 0 ||
      quotedNames.length > 0 ||
      capitalizedNames.length > 0) &&
    runtime.a2aClient
  ) {
    const orgsResult = await runtime.a2aClient.getOrganizations(100);
    const { organizations } =
      organizationMentionsContextSchema.parse(orgsResult);

    // Match tickers
    if (tickerMentions.length > 0) {
      const tickers = tickerMentions.map((m) => m.substring(1));
      const matchedOrgs = organizations.filter((org) =>
        tickers.some((t) => org.ticker?.toUpperCase() === t.toUpperCase())
      );
      results.push(
        ...matchedOrgs.map((c) => ({ type: 'company' as const, data: c }))
      );
    }

    // Match names
    const allNames = [
      ...quotedNames.map((n) => n.replace(/"/g, '')),
      ...capitalizedNames,
    ];
    if (allNames.length > 0) {
      const matchedOrgs = organizations.filter((org) =>
        allNames.some((name) =>
          org.name.toLowerCase().includes(name.toLowerCase())
        )
      );
      results.push(
        ...matchedOrgs.map((c) => ({ type: 'company' as const, data: c }))
      );
    }
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.type}:${r.data.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
