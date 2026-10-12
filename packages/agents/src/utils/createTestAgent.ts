/**
 * Test Agent Creation Utility
 *
 * Creates test agents for benchmarking and RL training with proper configuration.
 *
 * @packageDocumentation
 */

import { and, db, eq, inArray, like, userAgentConfigs, users } from '@feed/db';
import { ethers } from 'ethers';
import { agentRegistry } from '../services/agent-registry.service';
import { getAgentConfig } from '../shared/agent-config';
import { logger } from '../shared/logger';
import { generateSnowflakeId } from '../shared/snowflake';

export interface TestAgentConfig {
  username?: string;
  displayName?: string;
  virtualBalance?: number;
  autonomousTrading?: boolean;
  autonomousPosting?: boolean;
  autonomousCommenting?: boolean;
  autonomousDMs?: boolean;
  autonomousGroupChats?: boolean;
  systemPrompt?: string;
  modelTier?: 'lite' | 'standard' | 'pro';
}

export interface CreateTestAgentResult {
  agentId: string;
  created: boolean;
  agent: {
    id: string;
    username: string;
    displayName: string | null;
    isAgent: boolean;
  };
}

/**
 * LIKE pattern matching only usernames generated for `prefix`
 * (`${prefix}-<suffix>`). LIKE metacharacters in the prefix are escaped so
 * `%`/`_` cannot broaden the match, and the trailing `-` keeps `agent-1`
 * from matching `agent-10-…`.
 */
export function testAgentUsernamePattern(prefix: string): string {
  if (prefix.length === 0) {
    throw new Error('Test agent prefix must not be empty');
  }
  const escaped = prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `${escaped}-%`;
}

/** Only rows that are flagged as both test fixtures and agents are touched. */
function testAgentScope(prefix: string) {
  return and(
    like(users.username, testAgentUsernamePattern(prefix)),
    eq(users.isTest, true),
    eq(users.isAgent, true)
  );
}

/**
 * Creates or gets a test agent
 *
 * @param prefix - Username prefix for the test agent
 * @param config - Test agent configuration
 * @returns Test agent creation result
 */
export async function createTestAgent(
  prefix = 'test-agent',
  config: TestAgentConfig = {}
): Promise<CreateTestAgentResult> {
  const {
    username,
    displayName = `${prefix} ${Date.now().toString().slice(-6)}`,
    virtualBalance = 10000,
    autonomousTrading = true,
    autonomousPosting = true,
    autonomousCommenting = true,
    autonomousDMs = false,
    autonomousGroupChats = false,
    systemPrompt = 'You are an autonomous trading agent on Feed prediction markets. Make smart trading decisions based on market analysis.',
    modelTier = 'lite',
  } = config;

  if (!Number.isFinite(virtualBalance) || virtualBalance < 0) {
    throw new Error(
      `virtualBalance must be a finite non-negative number, got ${virtualBalance}`
    );
  }

  // Try to find existing test agent with same prefix
  let agentResult;
  if (username) {
    agentResult = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
  } else {
    agentResult = await db
      .select()
      .from(users)
      .where(testAgentScope(prefix))
      .limit(1);
  }

  let agent = agentResult[0];
  let created = false;

  if (!agent) {
    // Create new agent
    const agentId = await generateSnowflakeId();
    const finalUsername = username || `${prefix}-${agentId.slice(-6)}`;

    // Insert user + config atomically so a failure never leaves a
    // config-less agent behind.
    const configId = await generateSnowflakeId();
    agent = await db.transaction(async (tx) => {
      const [newAgent] = await tx
        .insert(users)
        .values({
          id: agentId,
          privyId: `did:privy:${prefix}-${agentId}`,
          username: finalUsername,
          displayName,
          walletAddress: ethers.Wallet.createRandom().address,
          isAgent: true,
          virtualBalance: String(virtualBalance),
          reputationPoints: 1000,
          isTest: true,
          updatedAt: new Date(),
        })
        .returning();

      await tx.insert(userAgentConfigs).values({
        id: configId,
        userId: agentId,
        autonomousTrading,
        autonomousPosting,
        autonomousCommenting,
        autonomousDMs,
        autonomousGroupChats,
        systemPrompt,
        modelTier,
        updatedAt: new Date(),
      });

      if (!newAgent) {
        throw new Error(`Failed to create test agent ${finalUsername}`);
      }
      return newAgent;
    });

    created = true;

    logger.info('Created test agent', {
      agentId: agent.id,
      username: agent.username,
      displayName: agent.displayName,
    });
  } else {
    logger.info('Using existing test agent', {
      agentId: agent.id,
      username: agent.username,
    });
  }

  // Register in Agent Registry if not already registered
  if (agent.isAgent) {
    // Check if already registered
    const existingReg = await agentRegistry.getAgentById(agent.id);

    if (!existingReg) {
      logger.info('Registering user agent...', { userId: agent.id });

      // Get agent config for system prompt
      const agentConfig = await getAgentConfig(agent.id);

      await agentRegistry.registerUserAgent({
        userId: agent.id,
        name: agent.displayName || agent.username || 'Test Agent',
        systemPrompt:
          agentConfig?.systemPrompt ||
          'You are a helpful AI agent on Feed prediction market.',
        capabilities: {
          strategies: [
            'prediction_markets',
            'social_interaction',
            'trading_analysis',
          ],
          markets: ['prediction', 'perpetual', 'spot'],
          actions: [
            'trade',
            'post',
            'comment',
            'like',
            'message',
            'analyze_market',
            'manage_portfolio',
          ],
          version: '1.0.0',
          x402Support: true,
          platform: 'feed',
          userType: 'user_controlled',
          skills: [],
          domains: [],
        },
      });
      logger.info('Registered test agent in registry', {
        agentId: agent.id,
      });
    }
  }

  return {
    agentId: agent.id,
    created,
    agent: {
      id: agent.id,
      username: agent.username!,
      displayName: agent.displayName,
      isAgent: agent.isAgent,
    },
  };
}

/**
 * Helper to create multiple test agents
 *
 * @param count - Number of agents to create
 * @param prefix - Username prefix
 * @param baseConfig - Base configuration for all agents
 * @returns Array of created agents
 */
export async function createTestAgents(
  count: number,
  prefix = 'test-agent',
  baseConfig: TestAgentConfig = {}
): Promise<CreateTestAgentResult[]> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`count must be a non-negative integer, got ${count}`);
  }
  const results: CreateTestAgentResult[] = [];

  for (let i = 0; i < count; i++) {
    const result = await createTestAgent(`${prefix}-${i}`, baseConfig);
    results.push(result);
  }

  return results;
}

/**
 * Cleanup test agents
 *
 * @param prefix - Username prefix to match
 * @returns Number of agents deleted
 */
export async function cleanupTestAgents(
  prefix = 'test-agent'
): Promise<number> {
  // Snapshot matching test-agent IDs, then delete exactly those rows.
  return await db.transaction(async (tx) => {
    const testAgents = await tx
      .select({ id: users.id })
      .from(users)
      .where(testAgentScope(prefix));

    if (testAgents.length === 0) {
      return 0;
    }

    const ids = testAgents.map((a) => a.id);
    await tx
      .delete(userAgentConfigs)
      .where(inArray(userAgentConfigs.userId, ids));
    const result = await tx
      .delete(users)
      .where(inArray(users.id, ids))
      .returning({ id: users.id });

    logger.info(`Cleaned up ${result.length} test agents`);
    return result.length;
  });
}
