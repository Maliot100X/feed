import { getSurplusConfig } from '@feed/shared';
/**
 * Multi-Agent Runtime Manager
 *
 * Runtime factory for all agent types (USER_CONTROLLED, NPC, EXTERNAL).
 * Manages multiple concurrent Eliza agent runtimes in a serverless environment.
 * Each agent gets its own isolated runtime instance with its own character configuration.
 *
 * @remarks
 * Integrates with AgentRegistry for lifecycle management and agent discovery.
 * Supports runtime caching for warm container reuse in serverless environments.
 *
 * @packageDocumentation
 */

import {
  AgentRuntime,
  type Character,
  type Plugin,
  type UUID,
} from '@elizaos/core';
import anthropicPlugin from '@elizaos/plugin-anthropic';
import openaiPlugin from '@elizaos/plugin-openai';
import {
  actorState,
  agentLogs,
  agentTrades,
  and,
  db,
  desc,
  eq,
  gte,
  users,
} from '@feed/db';
import {
  type ActorData,
  loadActorById,
  StaticDataRegistry,
} from '@feed/engine';
import {
  COORDINATOR_RUNTIME_ID as COORDINATOR_RUNTIME_ID_STRING,
  COORDINATOR_SYSTEM_PROMPT,
  GROQ_MODELS,
  type PackActor,
} from '@feed/shared';
import { feedPlugin } from '../plugins/feed';
import { enhanceRuntimeWithFeed } from '../plugins/feed/integration';
import { groqPlugin } from '../plugins/groq';
import { agentCorePlugin } from '../plugins/plugin-agent-core/src';
// TODO: experiencePlugin disabled due to missing plugin implementation
// Re-enable when plugin-experience is properly implemented and exports valid Plugin
// import { experiencePlugin } from '../plugins/plugin-experience/src';
import { trajectoryLoggerPlugin } from '../plugins/plugin-trajectory-logger/src';
import {
  wrapPluginActions,
  wrapPluginProviders,
} from '../plugins/plugin-trajectory-logger/src/action-interceptor';
import { TrajectoryLoggerService } from '../plugins/plugin-trajectory-logger/src/TrajectoryLoggerService';
import { userCorePlugin } from '../plugins/plugin-user-core/src';
import { agentRegistry } from '../services/agent-registry.service';
import { getAgentConfig } from '../shared/agent-config';
import { logger } from '../shared/logger';
import { generateSnowflakeId } from '../shared/snowflake';
import { type AgentRegistration, AgentType } from '../types/agent-registry';
import type { JsonValue } from '../types/common';
import { FeedRuntimeAdapter } from './FeedRuntimeAdapter';
import { installRuntimeProviders } from './runtime-providers';

/**
 * Extended AgentRuntime with Feed-specific properties
 * @internal
 */
interface ExtendedAgentRuntime extends AgentRuntime {
  currentModelVersion?: string;
  currentModel?: string;
  trajectoryLogger?: TrajectoryLoggerService;
}

/** Global runtime cache for warm container reuse */
const globalRuntimes = new Map<string, AgentRuntime>();

/** Global trajectory logger instances per agent */
const trajectoryLoggers = new Map<string, TrajectoryLoggerService>();

interface RuntimeLifecycleMetadata {
  createdAtMs: number;
  refreshCount: number;
}

/** Runtime lifecycle metadata used for periodic refresh decisions */
const runtimeLifecycleMetadata = new Map<string, RuntimeLifecycleMetadata>();

const DEFAULT_CONTEXT_REFRESH_HOURS = 48;
const MS_PER_HOUR = 60 * 60 * 1000;
const MAX_REFRESH_WINDOW_LOGS = 250;
const MAX_REFRESH_WINDOW_TRADES = 250;
const CONTEXT_REFRESH_INTERVAL_MS = (() => {
  const configured = Number(process.env.AGENT_CONTEXT_REFRESH_HOURS ?? '');
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured * MS_PER_HOUR);
  }
  return DEFAULT_CONTEXT_REFRESH_HOURS * MS_PER_HOUR;
})();

/** Pending runtime creation promises to prevent race conditions */
const pendingRuntimePromises = new Map<string, Promise<AgentRuntime>>();

/** Coordinator runtime ID cast to UUID type for ElizaOS */
const COORDINATOR_RUNTIME_ID = COORDINATOR_RUNTIME_ID_STRING as UUID;

export class AgentRuntimeManager {
  private static instance: AgentRuntimeManager;

  private constructor() {
    logger.info(
      'AgentRuntimeManager initialized',
      undefined,
      'AgentRuntimeManager'
    );
  }

  public static getInstance(): AgentRuntimeManager {
    if (!AgentRuntimeManager.instance) {
      AgentRuntimeManager.instance = new AgentRuntimeManager();
    }
    return AgentRuntimeManager.instance;
  }

  private shouldRefreshRuntime(createdAtMs: number): boolean {
    return Date.now() - createdAtMs >= CONTEXT_REFRESH_INTERVAL_MS;
  }

  private async persistContextRefreshSummary(
    agentUserId: string,
    lifecycle: RuntimeLifecycleMetadata
  ): Promise<void> {
    const refreshEndedAt = new Date();
    const refreshStartedAt = new Date(lifecycle.createdAtMs);

    const [windowLogs, windowTrades, userSnapshot, npcSnapshot] =
      await Promise.all([
        db
          .select({
            type: agentLogs.type,
            level: agentLogs.level,
            createdAt: agentLogs.createdAt,
          })
          .from(agentLogs)
          .where(
            and(
              eq(agentLogs.agentUserId, agentUserId),
              gte(agentLogs.createdAt, refreshStartedAt)
            )
          )
          .orderBy(desc(agentLogs.createdAt))
          .limit(MAX_REFRESH_WINDOW_LOGS),
        db
          .select({
            marketType: agentTrades.marketType,
            action: agentTrades.action,
            pnl: agentTrades.pnl,
            executedAt: agentTrades.executedAt,
          })
          .from(agentTrades)
          .where(
            and(
              eq(agentTrades.agentUserId, agentUserId),
              gte(agentTrades.executedAt, refreshStartedAt)
            )
          )
          .orderBy(desc(agentTrades.executedAt))
          .limit(MAX_REFRESH_WINDOW_TRADES),
        db
          .select({
            displayName: users.displayName,
            virtualBalance: users.virtualBalance,
            lifetimePnL: users.lifetimePnL,
          })
          .from(users)
          .where(eq(users.id, agentUserId))
          .limit(1),
        db
          .select({ tradingBalance: actorState.tradingBalance })
          .from(actorState)
          .where(eq(actorState.id, agentUserId))
          .limit(1),
      ]);

    const actionCounts = {
      ticks: 0,
      trades: 0,
      posts: 0,
      comments: 0,
      dms: 0,
      likes: 0,
      reposts: 0,
      errors: 0,
    };

    for (const entry of windowLogs) {
      if (entry.level === 'error') {
        actionCounts.errors++;
      }

      switch (entry.type) {
        case 'tick':
          actionCounts.ticks++;
          break;
        case 'trade':
          actionCounts.trades++;
          break;
        case 'post':
          actionCounts.posts++;
          break;
        case 'comment':
          actionCounts.comments++;
          break;
        case 'dm':
          actionCounts.dms++;
          break;
        case 'like':
          actionCounts.likes++;
          break;
        case 'repost':
          actionCounts.reposts++;
          break;
        default:
          break;
      }
    }

    const closedTrades = windowTrades.filter((trade) => trade.pnl !== null);
    const winningTrades = closedTrades.filter(
      (trade) => Number(trade.pnl ?? 0) > 0
    ).length;
    const realizedPnl = Number(
      closedTrades
        .reduce((acc, trade) => acc + Number(trade.pnl ?? 0), 0)
        .toFixed(2)
    );
    const runtimeAgeHours = Number(
      (
        (refreshEndedAt.getTime() - lifecycle.createdAtMs) /
        MS_PER_HOUR
      ).toFixed(2)
    );

    const user = userSnapshot[0];
    const npc = npcSnapshot[0];
    const balanceText = user
      ? `$${Number(user.virtualBalance ?? 0).toFixed(2)} balance, lifetime PnL ${Number(user.lifetimePnL ?? 0) >= 0 ? '+' : ''}$${Number(user.lifetimePnL ?? 0).toFixed(2)}`
      : npc
        ? `$${Number(npc.tradingBalance ?? 0).toFixed(2)} NPC trading balance`
        : 'balance unavailable';

    const summary =
      `Runtime refreshed after ${runtimeAgeHours}h. ` +
      `Window activity: ${actionCounts.ticks} ticks, ${actionCounts.trades} logged trades, ` +
      `${actionCounts.posts} posts, ${actionCounts.comments} comments, ${actionCounts.dms} DMs, ` +
      `${actionCounts.likes + actionCounts.reposts} engagements. ` +
      `Trade outcomes: ${windowTrades.length} trades, ${closedTrades.length} closed, ${winningTrades} wins, realized PnL ${realizedPnl >= 0 ? '+' : ''}$${Math.abs(realizedPnl).toFixed(2)}. ` +
      `Current state: ${balanceText}.`;

    const metadata: Record<string, JsonValue> = {
      event: 'context_refresh',
      summary,
      refreshCount: lifecycle.refreshCount + 1,
      refreshIntervalHours: Number(
        (CONTEXT_REFRESH_INTERVAL_MS / MS_PER_HOUR).toFixed(2)
      ),
      runtimeAgeHours,
      windowStart: refreshStartedAt.toISOString(),
      windowEnd: refreshEndedAt.toISOString(),
      actionCounts,
      tradeStats: {
        total: windowTrades.length,
        closed: closedTrades.length,
        wins: winningTrades,
        realizedPnl,
      },
      accountState: {
        displayName: user?.displayName ?? null,
        balance: user
          ? Number(user.virtualBalance ?? 0)
          : npc
            ? Number(npc.tradingBalance ?? 0)
            : null,
        lifetimePnl: user ? Number(user.lifetimePnL ?? 0) : null,
      },
      lastActionAt:
        windowLogs[0]?.createdAt instanceof Date
          ? windowLogs[0].createdAt.toISOString()
          : null,
      logsSampled: windowLogs.length,
      tradesSampled: windowTrades.length,
    };

    await db.insert(agentLogs).values({
      id: await generateSnowflakeId(),
      agentUserId,
      type: 'system',
      level: 'info',
      message: 'Context refresh checkpoint',
      metadata,
    });
  }

  /**
   * Gets or creates a runtime for any agent type
   *
   * Routes to type-specific factory based on registry entry, or falls back
   * to fallback USER_CONTROLLED if no registry entry exists.
   *
   * @param agentUserId - Agent user ID
   * @returns Agent runtime instance
   */
  public async getRuntime(agentUserId: string): Promise<AgentRuntime> {
    let refreshCount = 0;

    if (globalRuntimes.has(agentUserId)) {
      const lifecycle = runtimeLifecycleMetadata.get(agentUserId);

      if (!lifecycle) {
        runtimeLifecycleMetadata.set(agentUserId, {
          createdAtMs: Date.now(),
          refreshCount: 0,
        });
        const runtime = globalRuntimes.get(agentUserId)!;
        logger.info(
          `Using cached runtime for agent ${agentUserId} (lifecycle initialized)`,
          undefined,
          'AgentRuntimeManager'
        );
        return runtime;
      }

      if (!this.shouldRefreshRuntime(lifecycle.createdAtMs)) {
        const runtime = globalRuntimes.get(agentUserId)!;
        logger.info(
          `Using cached runtime for agent ${agentUserId}`,
          undefined,
          'AgentRuntimeManager'
        );
        return runtime;
      }

      refreshCount = lifecycle.refreshCount + 1;
      const runtimeAgeHours = (
        (Date.now() - lifecycle.createdAtMs) /
        MS_PER_HOUR
      ).toFixed(2);

      logger.info(
        `Refreshing runtime for agent ${agentUserId} after ${runtimeAgeHours}h`,
        {
          refreshIntervalHours: CONTEXT_REFRESH_INTERVAL_MS / MS_PER_HOUR,
          refreshCount,
        },
        'AgentRuntimeManager'
      );

      await this.persistContextRefreshSummary(agentUserId, lifecycle);

      await this.clearRuntime(agentUserId);
    }

    const registration = await agentRegistry.getAgentById(agentUserId);

    if (registration) {
      let runtime: AgentRuntime;
      switch (registration.type) {
        case AgentType.USER_CONTROLLED:
          runtime = await this.createUserAgentRuntime(registration);
          break;
        case AgentType.NPC:
          runtime = await this.createNpcRuntime(registration);
          break;
        case AgentType.EXTERNAL:
          runtime = await this.createExternalRuntime(registration);
          break;
        default:
          throw new Error(`Unknown agent type: ${registration.type}`);
      }

      // Update registry status to INITIALIZED
      // Generate unique runtime instance ID to track each runtime independently
      const runtimeInstanceId = await generateSnowflakeId();
      await agentRegistry.setRuntimeInstance(agentUserId, runtimeInstanceId);

      // Cache runtime
      globalRuntimes.set(agentUserId, runtime);
      runtimeLifecycleMetadata.set(agentUserId, {
        createdAtMs: Date.now(),
        refreshCount,
      });

      // Use debug level for per-agent runtime creation to reduce startup noise
      logger.debug(
        `Runtime created for ${registration.type} agent ${agentUserId}`,
        undefined,
        'AgentRuntimeManager'
      );

      return runtime;
    }

    // Fallback: Legacy behavior for USER_CONTROLLED agents not yet in registry
    // This maintains backward compatibility with existing code
    const [agentUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, agentUserId))
      .limit(1);

    if (!agentUser) {
      throw new Error(`Agent user ${agentUserId} not found`);
    }

    if (!agentUser.isAgent) {
      throw new Error(`User ${agentUserId} is not an agent`);
    }

    // Get agent config from separate table
    const agentConfig = await getAgentConfig(agentUserId);

    const parseBio = (): string[] => {
      if (!agentConfig?.messageExamples) {
        return [agentUser.bio || ''];
      }

      const parsed =
        typeof agentConfig.messageExamples === 'string'
          ? JSON.parse(agentConfig.messageExamples)
          : agentConfig.messageExamples;
      if (Array.isArray(parsed)) {
        return parsed;
      }
      logger.warn(
        'messageExamples is not an array, using bio',
        {
          agentId: agentUser.id,
          type: typeof parsed,
        },
        'AgentRuntimeManager'
      );
      return [agentUser.bio || ''];
    };

    const parseStyle = (): Record<string, JsonValue> | undefined => {
      if (!agentConfig?.style) {
        return undefined;
      }

      const style =
        typeof agentConfig.style === 'string'
          ? JSON.parse(agentConfig.style)
          : agentConfig.style;
      return style as Record<string, JsonValue>;
    };

    logger.info(
      'Agent using Groq models',
      {
        agentId: agentUserId,
        modelSmall:
          process.env.GROQ_SMALL_MODEL ||
          process.env.GROQ_PRIMARY_MODEL ||
          GROQ_MODELS.FREE.modelId,
        modelLarge:
          process.env.GROQ_LARGE_MODEL ||
          process.env.GROQ_PRIMARY_MODEL ||
          GROQ_MODELS.PRO.modelId,
      },
      'AgentRuntimeManager'
    );

    // Build character from agent user config
    // Use type assertion — Feed stores style as plain JSON objects,
    // but alpha elizaos Character expects protobuf StyleGuides.
    const character = {
      name: agentUser.displayName || agentUser.username || 'Agent',
      system: agentConfig?.systemPrompt || 'You are a helpful AI agent',
      bio: parseBio(),
      messageExamples: [],
      style: parseStyle(),
      plugins: [],
      settings: {
        // ElizaCloud unified inference (takes priority in direct-groq.ts and plugins)
        ELIZACLOUD_API_KEY: process.env.ELIZACLOUD_API_KEY || '',
        ELIZACLOUD_API_URL: process.env.ELIZACLOUD_API_URL || '',
        // GROQ configuration (used when ELIZACLOUD_API_KEY is not set)
        GROQ_API_KEY: process.env.GROQ_API_KEY || '',
        GROQ_LARGE_MODEL:
          process.env.GROQ_LARGE_MODEL ||
          process.env.GROQ_PRIMARY_MODEL ||
          GROQ_MODELS.PRO.modelId,
        GROQ_PRIMARY_MODEL:
          process.env.GROQ_PRIMARY_MODEL ||
          process.env.GROQ_LARGE_MODEL ||
          GROQ_MODELS.PRO.modelId,
        GROQ_SMALL_MODEL:
          process.env.GROQ_SMALL_MODEL ||
          process.env.GROQ_PRIMARY_MODEL ||
          GROQ_MODELS.FREE.modelId,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      },
    } as Character;

    // Database configuration
    const dbPort = process.env.POSTGRES_DEV_PORT || 5432;
    const postgresUrl =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      `postgres://postgres:password@localhost:${dbPort}/feed`;

    logger.info(
      `Creating runtime for agent user ${agentUserId}`,
      undefined,
      'AgentRuntimeManager'
    );

    const hasGroqAccess = !!(
      process.env.SURPLUS_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.ELIZACLOUD_API_KEY
    );
    const hasOpenAIAccess = !!(
      process.env.OPENAI_API_KEY || process.env.ELIZACLOUD_API_KEY
    );

    // Create runtime with groq, experience, trajectory logger, and agent core plugins
    // Type cast plugins to ensure compatibility across different @elizaos/core versions
    const plugins: Plugin[] = [
      agentCorePlugin as Plugin,
      // experiencePlugin as Plugin,
      trajectoryLoggerPlugin as Plugin,
      // Conditionally add LLM plugins based on available API keys
      ...(hasGroqAccess ? [groqPlugin as Plugin] : []),
      ...(!getSurplusConfig() && process.env.ANTHROPIC_API_KEY
        ? [anthropicPlugin as Plugin]
        : []),
      ...(!getSurplusConfig() && hasOpenAIAccess
        ? [openaiPlugin as Plugin]
        : []),
    ];

    const runtimeConfig = {
      character,
      agentId: agentUserId as UUID,
      plugins,
      settings: {
        ...character.settings,
        POSTGRES_URL: postgresUrl,
      },
    };

    const runtime = new AgentRuntime(runtimeConfig) as ExtendedAgentRuntime;

    runtime.currentModel = 'groq';

    // Feed persists domain state in PostgreSQL; runtime metadata is process-local.
    runtime.registerDatabaseAdapter(new FeedRuntimeAdapter());

    // Configure logger
    if (!runtime.logger || !runtime.logger.log) {
      const customLogger = {
        log: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentUser.displayName}]`),
        info: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentUser.displayName}]`),
        warn: (msg: string) =>
          logger.warn(msg, undefined, `Agent[${agentUser.displayName}]`),
        error: (msg: string) =>
          logger.error(msg, new Error(msg), `Agent[${agentUser.displayName}]`),
        debug: (msg: string) =>
          logger.debug(msg, undefined, `Agent[${agentUser.displayName}]`),
        success: (msg: string) =>
          logger.info(`✓ ${msg}`, undefined, `Agent[${agentUser.displayName}]`),
        notice: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentUser.displayName}]`),
        level: 'info' as const,
        trace: (msg: string) =>
          logger.debug(msg, undefined, `Agent[${agentUser.displayName}]`),
        fatal: (msg: string) =>
          logger.error(msg, new Error(msg), `Agent[${agentUser.displayName}]`),
        progress: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentUser.displayName}]`),
        // biome-ignore lint/suspicious/noConsole: console.clear is not a logging call
        clear: () => (console.clear ? console.clear() : undefined),
        child: () => customLogger,
      };
      // customLogger matches the structure of runtime.logger
      runtime.logger = customLogger as typeof runtime.logger;
    }

    // Initialize runtime to signal services that runtime is ready
    // This prevents 30s timeout errors in services waiting for runtime initialization
    // Skip ElizaOS plugin-sql migrations — Feed manages its own schema via Drizzle.
    // ElizaOS tables are included in packages/db/src/schema/eliza.ts and migrated with
    // `bun run db:generate && bun run db:migrate`. The framework's runtime migrator is
    // not designed for serverless and adds ~2 min cold-start overhead per agent.
    await runtime.initialize({ skipMigrations: true });
    installRuntimeProviders(runtime, plugins);

    // Register plugins
    const pluginRegistrationPromises: Promise<void>[] = [];
    const pluginsToLoad = plugins;

    for (const plugin of pluginsToLoad) {
      if (plugin) {
        pluginRegistrationPromises.push(runtime.registerPlugin(plugin));
      }
    }
    await Promise.all(pluginRegistrationPromises);

    const trajectoryLogger = await this.getRuntimeTrajectoryLogger(
      runtime,
      agentUserId
    );

    // Wrap Feed plugin BEFORE registering (so wrapped version is used)
    // This ensures all actions and provider accesses are logged when executed
    let wrappedFeedPlugin = feedPlugin;
    if (feedPlugin.actions) {
      wrappedFeedPlugin = wrapPluginActions(
        wrappedFeedPlugin,
        trajectoryLogger
      );
    }
    if (feedPlugin.providers) {
      wrappedFeedPlugin = wrapPluginProviders(
        wrappedFeedPlugin,
        trajectoryLogger
      );
    }

    // Enhance with wrapped Feed plugin (so wrapped version is registered)
    await enhanceRuntimeWithFeed(runtime, agentUserId, wrappedFeedPlugin);

    // Store trajectory logger reference on runtime for easy access
    // This allows actions/providers to access the logger
    runtime.trajectoryLogger = trajectoryLogger;

    // Cache runtime
    globalRuntimes.set(agentUserId, runtime);
    runtimeLifecycleMetadata.set(agentUserId, {
      createdAtMs: Date.now(),
      refreshCount,
    });

    // Use debug level for per-agent runtime creation to reduce startup noise
    logger.debug(
      `Runtime created for agent user ${agentUserId}`,
      undefined,
      'AgentRuntimeManager'
    );

    return runtime;
  }

  /**
   * Create runtime for USER_CONTROLLED agent
   * Uses registry data or falls back to User model
   */
  private async createUserAgentRuntime(
    registration: AgentRegistration
  ): Promise<AgentRuntime> {
    if (!registration.userId) {
      throw new Error(
        `USER_CONTROLLED agent ${registration.agentId} missing userId`
      );
    }

    // Fetch full user data
    const [agentUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, registration.userId))
      .limit(1);

    if (!agentUser) {
      throw new Error(`User ${registration.userId} not found`);
    }

    // Get agent config from separate table
    const userAgentConfig = await getAgentConfig(registration.userId);

    // Parse bio from messageExamples or bio field
    const parseBio = (): string[] => {
      if (!userAgentConfig?.messageExamples) {
        return [agentUser.bio || ''];
      }

      const parsed =
        typeof userAgentConfig.messageExamples === 'string'
          ? JSON.parse(userAgentConfig.messageExamples)
          : userAgentConfig.messageExamples;
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [agentUser.bio || ''];
    };

    // Parse style
    const parseStyle = (): Record<string, JsonValue> | undefined => {
      if (!userAgentConfig?.style) {
        return undefined;
      }

      const style =
        typeof userAgentConfig.style === 'string'
          ? JSON.parse(userAgentConfig.style)
          : userAgentConfig.style;
      return style;
    };

    // Build Character configuration
    // Use type assertion for style — Feed stores style as plain JSON,
    // but the alpha elizaos Character type expects a protobuf StyleGuides message.
    // The runtime normalizes this at init time.
    const character = {
      name: registration.name,
      system: registration.systemPrompt,
      bio: parseBio(),
      messageExamples: [],
      style: parseStyle(),
      plugins: [],
      settings: this.getModelSettings(),
    } as Character;

    // Create runtime with standard plugins
    // Pass userId for Feed integration (User table lookup)
    return this.createRuntimeWithPlugins(
      registration.agentId,
      character,
      registration.userId
    );
  }

  /**
   * Create runtime for NPC agent
   * Loads ActorData and creates Character from NPC configuration
   */
  private async createNpcRuntime(
    registration: AgentRegistration
  ): Promise<AgentRuntime> {
    // Verify actor exists in static registry
    const actor = StaticDataRegistry.getActor(registration.agentId);

    if (!actor) {
      throw new Error(
        `Actor ${registration.agentId} not found in static registry`
      );
    }

    // Try to get full PackActor for rich Eliza character fields
    const packActor: PackActor | undefined = StaticDataRegistry.getPackActor(
      registration.agentId
    );

    let character: Character;

    if (packActor) {
      // Build full Character from PackActor with ALL Eliza fields
      // Feed stores style/messageExamples as plain JSON objects;
      // ElizaOS Character type expects protobuf wrappers ($typeName, etc.).
      // The runtime normalizes these at init time — cast through unknown.
      character = {
        name: packActor.name,
        system: packActor.system,
        bio: packActor.bio,
        lore: packActor.lore,
        topics: packActor.topics,
        adjectives: packActor.adjectives,
        style: packActor.style,
        messageExamples: packActor.messageExamples,
        postExamples: packActor.postExamples,
        plugins: [],
        settings: {
          ...this.getModelSettings(),
          model: packActor.settings.model,
        },
      } as unknown as Character;

      // Attach feed metadata so MultiStepExecutor can access autonomy flags
      (character as unknown as Record<string, unknown>).feed = packActor.feed;
    } else {
      // Fallback: build minimal Character from ActorData (backward compat)
      const actorData: ActorData | null = loadActorById(actor.id);
      if (!actorData) {
        throw new Error(`ActorData ${actor.id} not found in data files`);
      }

      const bio: string[] = [];
      if (actorData.description) {
        bio.push(actorData.description);
      }
      if (actorData.pfpDescription) {
        bio.push(`Physical: ${actorData.pfpDescription}`);
      }
      if (actorData.role) {
        bio.push(`Role: ${actorData.role}`);
      }

      character = {
        name: registration.name,
        system: registration.systemPrompt,
        bio,
        messageExamples: [],
        plugins: [],
        settings: this.getModelSettings(),
      };
    }

    // Create runtime with standard plugins - pass isNpc=true to skip OpenAI/Anthropic validation
    return this.createRuntimeWithPlugins(
      registration.agentId,
      character,
      undefined,
      true
    );
  }

  /**
   * Create runtime for EXTERNAL agent
   * Minimal Character config for external agents using A2A/MCP protocols
   */
  private async createExternalRuntime(
    registration: AgentRegistration
  ): Promise<AgentRuntime> {
    // External agents may not have full Character config
    // Use minimal viable configuration
    const character: Character = {
      name: registration.name,
      system: registration.systemPrompt,
      bio: [registration.systemPrompt],
      messageExamples: [],
      plugins: [],
      settings: this.getModelSettings(),
    };

    // External agents may use different plugins
    // For now, use standard plugins (can be extended later)
    return this.createRuntimeWithPlugins(registration.agentId, character);
  }

  /**
   * Create AgentRuntime with standard plugin configuration
   * Shared logic for all agent types
   *
   * @param agentId - The agent's unique identifier (used for Eliza runtime)
   * @param character - Character configuration
   * @param userId - Optional User table ID for USER_CONTROLLED agents (used for Feed integration)
   * @param isNpc - Whether this is an NPC agent (skips OpenAI plugin to avoid validation spam)
   */
  private async createRuntimeWithPlugins(
    agentId: string,
    character: Character,
    userId?: string,
    isNpc?: boolean
  ): Promise<AgentRuntime> {
    // Database configuration
    const dbPort = process.env.POSTGRES_DEV_PORT || 5432;
    const postgresUrl =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      `postgres://postgres:password@localhost:${dbPort}/feed`;

    // Create runtime with standard plugins
    // NPCs use GROQ only - skip OpenAI/Anthropic to avoid API validation spam during bootstrap
    const hasGroqAccess = !!(
      process.env.SURPLUS_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.ELIZACLOUD_API_KEY
    );
    const hasOpenAIAccess = !!(
      process.env.OPENAI_API_KEY || process.env.ELIZACLOUD_API_KEY
    );
    const plugins: Plugin[] = [
      agentCorePlugin as Plugin,
      trajectoryLoggerPlugin as Plugin,
      // GROQ (or ElizaCloud) is always available for NPCs
      ...(hasGroqAccess ? [groqPlugin as Plugin] : []),
      // Only load Anthropic/OpenAI for non-NPC agents to avoid validation spam
      ...(!process.env.SURPLUS_API_KEY &&
      !isNpc &&
      process.env.ANTHROPIC_API_KEY
        ? [anthropicPlugin as Plugin]
        : []),
      ...(!process.env.SURPLUS_API_KEY && !isNpc && hasOpenAIAccess
        ? [openaiPlugin as Plugin]
        : []),
    ];

    const runtimeConfig = {
      character,
      agentId: agentId as UUID,
      plugins,
      settings: {
        ...character.settings,
        POSTGRES_URL: postgresUrl,
      },
    };

    const runtime = new AgentRuntime(runtimeConfig) as ExtendedAgentRuntime;

    // Store model version on runtime for LLM call logging
    if (character.settings?.MODEL_VERSION) {
      runtime.currentModelVersion = character.settings.MODEL_VERSION as string;
    }
    runtime.currentModel = 'groq';

    // Feed persists domain state in PostgreSQL; runtime metadata is process-local.
    runtime.registerDatabaseAdapter(new FeedRuntimeAdapter());

    // Configure logger
    this.configureLogger(runtime, character.name ?? 'agent');

    // Register plugins
    const pluginRegistrationPromises: Promise<void>[] = [];
    const pluginsToLoad = plugins;

    for (const plugin of pluginsToLoad) {
      if (plugin) {
        pluginRegistrationPromises.push(runtime.registerPlugin(plugin));
      }
    }
    await Promise.all(pluginRegistrationPromises);

    // Initialize runtime to signal services that runtime is ready
    // This prevents 30s timeout errors in services waiting for runtime initialization
    // Skip migrations — see comment in createNPCAgentRuntime for rationale.
    await runtime.initialize({ skipMigrations: true });
    installRuntimeProviders(runtime, plugins);

    const trajectoryLogger = await this.getRuntimeTrajectoryLogger(
      runtime,
      agentId
    );

    // Wrap and enhance with Feed plugin
    // Use userId for USER_CONTROLLED agents (User table lookup), agentId for NPCs
    const feedAgentId = userId || agentId;
    await this.enhanceWithFeed(runtime, feedAgentId, trajectoryLogger);

    // Store trajectory logger reference on runtime
    runtime.trajectoryLogger = trajectoryLogger;

    return runtime;
  }

  /**
   * Get model settings (Groq configuration)
   * Shared logic for model configuration
   */
  private getModelSettings(): Record<string, string> {
    return {
      // ElizaCloud unified inference (takes priority over direct provider keys)
      ELIZACLOUD_API_KEY: process.env.ELIZACLOUD_API_KEY || '',
      ELIZACLOUD_API_URL: process.env.ELIZACLOUD_API_URL || '',
      // GROQ configuration (used when ELIZACLOUD_API_KEY is not set)
      // Keys must match what groq.ts plugin looks up via runtime.getSetting()
      GROQ_API_KEY: process.env.GROQ_API_KEY || '',
      GROQ_BASE_URL: process.env.GROQ_BASE_URL || '',
      GROQ_LARGE_MODEL:
        process.env.GROQ_LARGE_MODEL ||
        process.env.GROQ_PRIMARY_MODEL ||
        GROQ_MODELS.PRO.modelId,
      GROQ_PRIMARY_MODEL:
        process.env.GROQ_PRIMARY_MODEL ||
        process.env.GROQ_LARGE_MODEL ||
        GROQ_MODELS.PRO.modelId,
      GROQ_SMALL_MODEL:
        process.env.GROQ_SMALL_MODEL ||
        process.env.GROQ_PRIMARY_MODEL ||
        GROQ_MODELS.FREE.modelId,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    };
  }

  /**
   * Configure runtime logger
   */
  private configureLogger(runtime: AgentRuntime, agentName: string): void {
    if (!runtime.logger || !runtime.logger.log) {
      const customLogger = {
        log: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentName}]`),
        info: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentName}]`),
        warn: (msg: string) =>
          logger.warn(msg, undefined, `Agent[${agentName}]`),
        error: (msg: string) =>
          logger.error(msg, new Error(msg), `Agent[${agentName}]`),
        debug: (msg: string) =>
          logger.debug(msg, undefined, `Agent[${agentName}]`),
        success: (msg: string) =>
          logger.info(`✓ ${msg}`, undefined, `Agent[${agentName}]`),
        notice: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentName}]`),
        level: 'info' as const,
        trace: (msg: string) =>
          logger.debug(msg, undefined, `Agent[${agentName}]`),
        fatal: (msg: string) =>
          logger.error(msg, new Error(msg), `Agent[${agentName}]`),
        progress: (msg: string) =>
          logger.info(msg, undefined, `Agent[${agentName}]`),
        // biome-ignore lint/suspicious/noConsole: console.clear is not a logging call
        clear: () => (console.clear ? console.clear() : undefined),
        child: () => customLogger,
      } as typeof runtime.logger;
      runtime.logger = customLogger;
    }
  }

  private async getRuntimeTrajectoryLogger(
    runtime: AgentRuntime,
    runtimeId: string
  ): Promise<TrajectoryLoggerService> {
    const existing = runtime.getService<TrajectoryLoggerService>(
      TrajectoryLoggerService.serviceType
    );

    if (existing) {
      trajectoryLoggers.set(runtimeId, existing);
      return existing;
    }

    const service = (await runtime.getServiceLoadPromise(
      TrajectoryLoggerService.serviceType
    )) as TrajectoryLoggerService;

    trajectoryLoggers.set(runtimeId, service);
    return service;
  }

  /**
   * Enhance runtime with Feed plugin (wrapped for trajectory logging)
   */
  private async enhanceWithFeed(
    runtime: AgentRuntime,
    agentId: string,
    trajectoryLogger: TrajectoryLoggerService
  ): Promise<void> {
    // Wrap Feed plugin BEFORE registering (so wrapped version is used)
    let wrappedFeedPlugin = feedPlugin;
    if (feedPlugin.actions) {
      wrappedFeedPlugin = wrapPluginActions(
        wrappedFeedPlugin,
        trajectoryLogger
      );
    }
    if (feedPlugin.providers) {
      wrappedFeedPlugin = wrapPluginProviders(
        wrappedFeedPlugin,
        trajectoryLogger
      );
    }

    // Enhance with wrapped Feed plugin
    await enhanceRuntimeWithFeed(runtime, agentId, wrappedFeedPlugin);
  }

  /**
   * Get or create the global coordinator runtime.
   *
   * The coordinator is a shared runtime used for team chat when no agents are tagged.
   * It uses plugin-user-core (limited actions) instead of plugin-agent-core.
   *
   * @returns The global coordinator runtime instance
   */
  public async getCoordinatorRuntime(): Promise<AgentRuntime> {
    // Check cache first
    if (globalRuntimes.has(COORDINATOR_RUNTIME_ID)) {
      logger.debug(
        'Using cached coordinator runtime',
        undefined,
        'AgentRuntimeManager'
      );
      return globalRuntimes.get(COORDINATOR_RUNTIME_ID)!;
    }

    // Check if there's already a pending creation to avoid race conditions
    const pendingPromise = pendingRuntimePromises.get(COORDINATOR_RUNTIME_ID);
    if (pendingPromise) {
      logger.debug(
        'Waiting for pending coordinator runtime creation',
        undefined,
        'AgentRuntimeManager'
      );
      return pendingPromise;
    }

    // Create new coordinator runtime with pending-promise guard
    const creationPromise = (async () => {
      try {
        const runtime = await this.createCoordinatorRuntime();

        // Cache it
        globalRuntimes.set(COORDINATOR_RUNTIME_ID, runtime);

        logger.info(
          'Coordinator runtime created and cached',
          undefined,
          'AgentRuntimeManager'
        );

        return runtime;
      } finally {
        // Clear pending entry on completion or error
        pendingRuntimePromises.delete(COORDINATOR_RUNTIME_ID);
      }
    })();

    // Store the pending promise so concurrent callers await it
    pendingRuntimePromises.set(COORDINATOR_RUNTIME_ID, creationPromise);

    return creationPromise;
  }

  /**
   * Create the global coordinator runtime.
   *
   * Key differences from agent runtimes:
   * - Uses plugin-user-core instead of plugin-agent-core
   * - Has limited actions (read-only, informational)
   * - Does not have Feed plugin enhancement (no agent-specific features)
   * - Shared across all users
   */
  private async createCoordinatorRuntime(): Promise<AgentRuntime> {
    // Database configuration
    const dbPort = process.env.POSTGRES_DEV_PORT || 5432;
    const postgresUrl =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      `postgres://postgres:password@localhost:${dbPort}/feed`;

    // Character configuration for coordinator
    const character: Character = {
      name: 'Coordinator',
      system: COORDINATOR_SYSTEM_PROMPT,
      bio: [
        'Team chat coordinator for Feed - helps users understand and coordinate their AI agents',
      ],
      messageExamples: [],
      plugins: [],
      settings: this.getModelSettings(),
    };

    // Plugins for coordinator - uses userCorePlugin instead of agentCorePlugin
    // Note: openaiPlugin is intentionally omitted for coordinator as it uses read-only
    // actions (userCorePlugin) and doesn't require the full capabilities of OpenAI models.
    // The coordinator relies on Groq/ElizaCloud/Anthropic for cost efficiency with its limited scope.
    const hasGroqAccessCoordinator = !!(
      process.env.SURPLUS_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.ELIZACLOUD_API_KEY
    );
    const plugins: Plugin[] = [
      userCorePlugin as Plugin, // Limited actions for coordinator
      trajectoryLoggerPlugin as Plugin,
      ...(hasGroqAccessCoordinator ? [groqPlugin as Plugin] : []),
      ...(!getSurplusConfig() && process.env.ANTHROPIC_API_KEY
        ? [anthropicPlugin as Plugin]
        : []),
    ];

    const runtimeConfig = {
      character,
      agentId: COORDINATOR_RUNTIME_ID,
      plugins,
      settings: {
        ...character.settings,
        POSTGRES_URL: postgresUrl,
      },
    };

    const runtime = new AgentRuntime(runtimeConfig) as ExtendedAgentRuntime;

    runtime.currentModel = 'groq';

    // Runtime metadata is process-local; Feed domain records use PostgreSQL.
    runtime.registerDatabaseAdapter(new FeedRuntimeAdapter());

    // Configure logger
    this.configureLogger(runtime, 'Coordinator');

    // Register plugins
    const pluginRegistrationPromises: Promise<void>[] = [];
    for (const plugin of plugins) {
      if (plugin) {
        pluginRegistrationPromises.push(runtime.registerPlugin(plugin));
      }
    }
    await Promise.all(pluginRegistrationPromises);

    // Initialize runtime to signal services that runtime is ready
    // This prevents 30s timeout errors in services waiting for runtime initialization
    // Skip migrations — see comment in createNPCAgentRuntime for rationale.
    await runtime.initialize({ skipMigrations: true });
    installRuntimeProviders(runtime, plugins);

    const trajectoryLogger = await this.getRuntimeTrajectoryLogger(
      runtime,
      COORDINATOR_RUNTIME_ID
    );

    // Store trajectory logger reference
    runtime.trajectoryLogger = trajectoryLogger;

    // NOTE: We intentionally do NOT call enhanceWithFeed here
    // The coordinator doesn't need agent-specific Feed features

    return runtime;
  }

  /**
   * Get trajectory logger for an agent
   */
  public getTrajectoryLogger(
    agentUserId: string
  ): TrajectoryLoggerService | null {
    return trajectoryLoggers.get(agentUserId) || null;
  }

  /**
   * Remove runtime from cache
   */
  public async clearRuntime(agentUserId: string): Promise<void> {
    if (globalRuntimes.has(agentUserId)) {
      await globalRuntimes.get(agentUserId)!.stop();
      globalRuntimes.delete(agentUserId);
      trajectoryLoggers.delete(agentUserId);
      runtimeLifecycleMetadata.delete(agentUserId);

      // Update registry status if agent exists in registry
      await agentRegistry.clearRuntimeInstance(agentUserId);

      logger.info(
        `Runtime cleared for agent ${agentUserId}`,
        undefined,
        'AgentRuntimeManager'
      );
    }
  }

  /**
   * Backwards-compatible alias used by the training package.
   */
  public async resetRuntime(agentUserId: string): Promise<void> {
    await this.clearRuntime(agentUserId);
  }

  public clearAllRuntimes(): void {
    globalRuntimes.clear();
    trajectoryLoggers.clear();
    runtimeLifecycleMetadata.clear();
    logger.info('All runtimes cleared', undefined, 'AgentRuntimeManager');
  }

  public getRuntimeCount(): number {
    return globalRuntimes.size;
  }

  public hasRuntime(agentUserId: string): boolean {
    return globalRuntimes.has(agentUserId);
  }
}

// Export singleton instance (lazy initialization to avoid circular dependencies)
let _agentRuntimeManagerInstance: AgentRuntimeManager | null = null;

function getManagerInstance(): AgentRuntimeManager {
  if (!_agentRuntimeManagerInstance) {
    _agentRuntimeManagerInstance = AgentRuntimeManager.getInstance();
  }
  return _agentRuntimeManagerInstance;
}

export const agentRuntimeManager = {
  getInstance(): AgentRuntimeManager {
    return getManagerInstance();
  },
  async getRuntime(agentUserId: string) {
    return getManagerInstance().getRuntime(agentUserId);
  },
  async getCoordinatorRuntime() {
    return getManagerInstance().getCoordinatorRuntime();
  },
  getTrajectoryLogger(agentUserId: string) {
    return getManagerInstance().getTrajectoryLogger(agentUserId);
  },
  async clearRuntime(agentUserId: string) {
    return getManagerInstance().clearRuntime(agentUserId);
  },
  async resetRuntime(agentUserId: string) {
    return getManagerInstance().resetRuntime(agentUserId);
  },
  clearAllRuntimes() {
    return getManagerInstance().clearAllRuntimes();
  },
  getRuntimeCount() {
    return getManagerInstance().getRuntimeCount();
  },
  hasRuntime(agentUserId: string) {
    return getManagerInstance().hasRuntime(agentUserId);
  },
} as AgentRuntimeManager & { getInstance(): AgentRuntimeManager };
