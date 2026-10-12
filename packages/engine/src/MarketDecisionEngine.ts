/**
 * Market Decision Engine - NPC Trading Decision Generator
 *
 * @module engine/MarketDecisionEngine
 *
 * @description
 * Generates autonomous trading decisions for all NPCs using LLM-powered analysis.
 * Creates realistic market behavior where NPCs trade based on information, relationships,
 * and personality rather than following predetermined patterns.
 *
 * **Core Functionality:**
 * - Generates trading decisions for all trading-enabled NPCs
 * - Uses LLM to analyze market context and make human-like decisions
 * - Batches NPCs together to minimize LLM costs (90% reduction vs individual calls)
 * - Token-aware with automatic chunking for large batches
 * - Validates decisions against constraints (balance, market availability)
 *
 * **Decision Types:**
 * - `open_long` / `open_short` - Open perpetual futures positions
 * - `buy_yes` / `buy_no` - Buy prediction market shares
 * - `close_position` - Close existing position
 * - `hold` - No action this tick
 *
 * **Context Provided to LLM:**
 * - NPC profile (personality, tier, balance)
 * - Relationships with other NPCs (allies/rivals affect decisions)
 * - Recent posts and articles (public information)
 * - Group chat messages (insider information)
 * - Recent events (last 24h narrative developments)
 * - Active questions (especially comparative ones like "Will X outperform Y?")
 * - Reality grounding (current date, prices, market context)
 * - Available markets (perps and predictions)
 * - Current positions (P&L, sizing)
 *
 * **Batching Strategy:**
 * - Groups NPCs into batches that fit token limits
 * - Typical: 5-15 NPCs per batch depending on context size
 * - Preserves individual context for each NPC
 * - LLM generates array of decisions (one per NPC)
 *
 * **Validation:**
 * - Rejects trades exceeding NPC balance
 * - Verifies market/ticker existence
 * - Validates action types
 * - Checks position ownership for closes
 * - Returns only valid decisions
 *
 * @see {@link TradeExecutionService} - Executes validated decisions
 * @see {@link MarketContextService} - Builds NPC context
 * @see {@link executeGameTick} - Production tick calls generateBatchDecisions() each tick
 *
 * @example
 * ```typescript
 * const engine = new MarketDecisionEngine(llm, contextService);
 *
 * // Generate decisions for all NPCs
 * const decisions = await engine.generateBatchDecisions();
 * // => [
 * //   { npcId: 'alice', action: 'buy_yes', marketId: 5, amount: 100, ... },
 * //   { npcId: 'bob', action: 'hold', ... },
 * //   { npcId: 'charlie', action: 'open_long', ticker: 'TECH', amount: 500, ... }
 * // ]
 *
 * // Execute the trades
 * await tradeExecutionService.executeDecisionBatch(decisions);
 * ```
 */

import {
  actorState,
  and,
  db,
  desc,
  eq,
  gte,
  inArray,
  npcTrades,
  posts,
  questions,
} from '@feed/db';
import { logger } from '@feed/shared';
import { getTradingProbability } from './config/npc-activity';
import {
  formatSimulationEventMarketSignals,
  formatSimulationPredictionMarkets,
  formatSimulationRecentEvents,
} from './config/simulation';
import type { FeedLLMClient } from './llm/openai-client';
import {
  countTokensSync,
  getModelTokenLimit,
  getSafeContextLimit,
} from './llm/token-counter';
import { parseXML } from './llm/xml-parser';
import {
  generateWorldContext,
  getShuffledExamplesText,
  npcMarketDecisions,
  renderPrompt,
} from './prompts';
import { EventMarketLinkerService } from './services/event-market-linker';
import type { MarketContextService } from './services/market-context-service';
import { MarketMomentumService } from './services/market-momentum-service';
import { NpcMemoryService } from './services/npc-memory-service';
import { StaticDataRegistry } from './services/static-data-registry';
import { isSimulationMode } from './storage-bridge';
import type { JsonValue } from './types/common';
import type { NPCMarketContext } from './types/market-context';
import type { TradingDecision } from './types/market-decisions';
import { firstOrThrow } from './utils/array-utils';
import { formatError } from './utils/error-utils';
import {
  formatMarketDataTable,
  formatNPCsDashboardList,
} from './utils/trading-dashboard-format';
import { validateTradingDecisions } from './utils/validate-trading-decisions';

/**
 * Token management configuration
 *
 * @interface TokenConfig
 *
 * @property model - LLM model name (e.g., 'openai/gpt-oss-120b' for Groq)
 * @property maxContextTokens - Maximum tokens for prompt context
 * @property maxOutputTokens - Maximum tokens for LLM response
 * @property tokensPerNPC - Estimated tokens per NPC context section
 */
interface TokenConfig {
  model: string | undefined;
  maxContextTokens: number;
  maxOutputTokens: number;
  tokensPerNPC: number;
  customApiUrl?: string;
  customModelName?: string;
}

/**
 * Market Decision Engine
 *
 * @class MarketDecisionEngine
 *
 * @description
 * Generates trading decisions for NPCs using LLM-powered market analysis.
 * Automatically handles batching and token management to process all NPCs
 * efficiently while staying within model context limits.
 *
 * **Key Responsibilities:**
 * - Generate realistic trading decisions based on NPC context
 * - Batch NPCs to minimize LLM API costs
 * - Manage token budgets automatically
 * - Validate all decisions against constraints
 * - Handle both individual and batch generation
 *
 * **Architecture:**
 * - Uses `openai/gpt-oss-120b` on Groq for speed and reliability (130k context)
 * - Dynamically calculates batch sizes based on token limits
 * - Falls back to individual processing if batches fail
 * - Strict validation prevents invalid trades
 * - Intelligent caching (1-minute TTL) reduces redundant DB queries across batches
 *
 * @usage
 * Created once by GameEngine and called each tick to generate NPC trading decisions.
 */
export class MarketDecisionEngine {
  private tokenConfig: TokenConfig;
  private memoryService = new NpcMemoryService();

  // Caches to avoid redundant queries within same tick
  private worldContextCache: {
    context: Awaited<ReturnType<typeof generateWorldContext>>;
    timestamp: number;
  } | null = null;
  private activeQuestionsCache: {
    questions: string;
    timestamp: number;
  } | null = null;
  private recentEventsCache: { events: string; timestamp: number } | null =
    null;
  private resolvedQuestionsCache: {
    text: string;
    timestamp: number;
  } | null = null;
  private previousTradesCache: {
    text: string;
    timestamp: number;
  } | null = null;
  private eventMarketSignalsCache: {
    signals: string;
    timestamp: number;
  } | null = null;
  private momentumAlertsCache: {
    alerts: string;
    timestamp: number;
  } | null = null;
  private readonly CACHE_TTL_MS = 60000; // 1 minute TTL for caches

  /**
   * Create a new MarketDecisionEngine
   *
   * @param llm - Feed LLM client for decision generation
   * @param contextService - Service for building NPC market context
   * @param options - Optional configuration overrides
   * @param options.model - LLM model to use (default: 'openai/gpt-oss-120b' on Groq)
   * @param options.maxOutputTokens - Maximum tokens for response (default: 32k for gpt-oss-120b, 16k for Kimi)
   *
   * @description
   * Initializes the engine with token management configuration. Automatically
   * calculates safe context limits based on model and output requirements.
   *
   * **Model Selection:**
   * - Default: `openai/gpt-oss-120b` on Groq (fast, 130k context)
   * - Alternative: Kimi models for high-quality content generation
   * - Fallback: OpenAI gpt-5-nano (only if no Groq API key)
   *
   * **Token Budget:**
   * - Automatically calculated from model INPUT limits (output is separate)
   * - gpt-oss-120b: 130k INPUT (117k after safety), up to 65k OUTPUT (separate)
   * - Estimates ~400 tokens per NPC context
   * - Can handle 294 NPCs per batch (117k ÷ 400), typically processes 64 NPCs easily
   *
   * @example
   * ```typescript
   * const engine = new MarketDecisionEngine(
   *   llmClient,
   *   contextService,
   *   {
   *     model: 'openai/gpt-oss-120b',  // Default - uses Groq
   *     maxOutputTokens: 32000      // 32k for gpt-oss-120b, 16k for Kimi
   *   }
   * );
   * ```
   */
  constructor(
    private llm: FeedLLMClient,
    private contextService: MarketContextService,
    options: {
      model?: string;
      maxOutputTokens?: number;
      useLocalModel?: boolean;
      localModelUrl?: string;
    } = {}
  ) {
    // Use provider-appropriate model, or let LLM client use its default
    const provider = llm.getProvider();
    let model: string | undefined;

    // 1. Check for Local Model / RL Training Override
    if (options.useLocalModel || options.localModelUrl) {
      throw new Error(
        'Local model routing is not implemented by MarketDecisionEngine; refusing to send a local-model request to a remote provider'
      );
    }
    // 2. Check for explicit model override
    if (options.model) {
      model = options.model;
    }
    // 3. Provider-specific defaults
    else if (provider === 'groq') {
      model =
        process.env.MARKET_DECISION_MODEL ||
        process.env.GROQ_PRIMARY_MODEL ||
        process.env.GROQ_LARGE_MODEL ||
        'openai/gpt-oss-120b';
    } else {
      // Let LLM client use its default for other providers
      model = undefined;
    }

    // Reserve output within the combined context window.
    const isKimiModel = model?.toLowerCase().includes('kimi') ?? false;
    const isOpenAIModel = llm.getProvider() === 'openai';
    const isLlama8B = model?.includes('llama-3.1-8b') ?? false;

    // Set appropriate output limits based on model
    let defaultMaxOutput = 32000; // Default for most models
    if (isKimiModel) {
      defaultMaxOutput = 16000; // Kimi: 16,384 max output
    } else if (model?.includes('gpt-oss-120b')) {
      defaultMaxOutput = 65536; // gpt-oss-120b on Groq: 65,536 max output
    } else if (isLlama8B) {
      defaultMaxOutput = 131000; // llama-3.1-8b: 131k max output (unique - same as input!)
    }
    if (isOpenAIModel) {
      // OpenAI models: max 16k output tokens, but be conservative to avoid combined limit errors
      // If prompt is large, reduce output tokens accordingly
      defaultMaxOutput = 8000; // Conservative limit for OpenAI to avoid "reduce length" errors
    }

    const maxOutputTokens =
      options.maxOutputTokens ??
      Math.min(
        defaultMaxOutput,
        Math.floor(getModelTokenLimit(model || llm.getStats().model) / 4)
      );

    // Use a default model for token limit calculation if model is undefined
    // Default to a conservative model with good context (gpt-5-nano: 128k)
    const modelForTokenLimit = model || llm.getStats().model;

    this.tokenConfig = {
      model,
      maxContextTokens: getSafeContextLimit(
        modelForTokenLimit,
        maxOutputTokens
      ),
      maxOutputTokens,
      tokensPerNPC: 2000, // Increased to 2000 to be conservative and avoid context limit errors
    };

    logger.info(
      'MarketDecisionEngine initialized',
      {
        model,
        provider: llm.getProvider(),
        maxContextTokens: this.tokenConfig.maxContextTokens,
        maxOutputTokens,
        isOpenAIModel,
        useLocalModel: options.useLocalModel,
      },
      'MarketDecisionEngine'
    );
  }

  /**
   * Generate trading decisions for all NPCs
   *
   * @returns Array of validated trading decisions
   *
   * @description
   * Main entry point for NPC decision generation. Automatically handles:
   * - Fetching context for all trading-enabled NPCs
   * - Splitting into batches if needed for token limits
   * - Generating decisions via LLM
   * - Validating all decisions
   * - Fallback to individual processing on batch failure
   *
   * **Process:**
   * 1. Fetch context for all NPCs via MarketContextService
   * 2. Calculate batch size based on token budget
   * 3. Process NPCs in batches via LLM
   * 4. Validate each decision against constraints
   * 5. Return only valid decisions
   *
   * **Performance:**
   * - Typical: 1 LLM call for 64 NPCs (single batch with 130k context)
   * - Fallback: Individual calls if batching fails (rare)
   * - ~5-10 seconds for full decision generation on gpt-oss-120b
   *
   * **Error Handling:**
   * - Batch failures trigger individual retry
   * - Individual failures logged but don't fail entire generation
   * - Always returns best-effort decision array
   *
   * @example
   * ```typescript
   * const decisions = await engine.generateBatchDecisions();
   *
   * console.log(`Generated ${decisions.length} decisions`);
   * console.log(`Trades: ${decisions.filter(d => d.action !== 'hold').length}`);
   * console.log(`Holds: ${decisions.filter(d => d.action === 'hold').length}`);
   * ```
   */
  async generateBatchDecisions(options?: {
    priceOverrides?: Map<string, number>;
    recentEvents?: Array<{
      type: string;
      description: string;
      timestamp: string;
      sentiment?: number;
      relatedTickers?: string[];
    }>;
  }): Promise<TradingDecision[]> {
    const startTime = Date.now();

    // Get context for all NPCs (with optional overrides for causal simulation)
    const contexts = await this.contextService.buildContextForAllNPCs(options);

    if (contexts.size === 0) {
      logger.warn(
        'No NPCs with trading enabled found',
        {},
        'MarketDecisionEngine'
      );
      return [];
    }

    logger.info(
      `Generating decisions for ${contexts.size} NPCs`,
      { npcCount: contexts.size },
      'MarketDecisionEngine'
    );

    // Convert contexts to array
    const allNpcs = Array.from(contexts.values());

    // Filter NPCs by trading probability - only include NPCs that pass a random roll
    // This reduces the number of NPCs that get trading decisions each tick
    const tradingProbability = getTradingProbability();
    const npcs = allNpcs.filter(() => Math.random() < tradingProbability);

    logger.info(
      `Filtered NPCs by trading probability`,
      {
        totalNpcs: allNpcs.length,
        eligibleNpcs: npcs.length,
        tradingProbability,
      },
      'MarketDecisionEngine'
    );

    if (npcs.length === 0) {
      logger.info(
        'No NPCs passed trading probability filter this tick',
        { tradingProbability, totalNpcs: allNpcs.length },
        'MarketDecisionEngine'
      );
      return [];
    }

    // Calculate how many NPCs we can process per batch
    // For OpenAI models, be more conservative due to combined input+output limits
    const isOpenAIModel = this.llm.getProvider() === 'openai';

    // Use a conservative estimate with safety margin (reserve 50% for prompt structure and variations)
    const safetyMargin = 0.5; // Use only 50% of available tokens to avoid "reduce length" errors
    let maxNPCsPerBatch = Math.max(
      1,
      Math.floor(
        (this.tokenConfig.maxContextTokens * safetyMargin) /
          this.tokenConfig.tokensPerNPC
      )
    );

    // Cap batch size to avoid hitting output token limits
    // Each NPC decision can generate ~800-1000 tokens of output
    // Groq API has practical output limit of ~4000 tokens (not the documented 40k)
    // So we need to limit to 4 NPCs per batch for Groq to stay under limit
    const isGroqProvider = this.llm.getProvider() === 'groq';
    const MAX_NPCS_FOR_OUTPUT = isGroqProvider ? 4 : 20;
    maxNPCsPerBatch = Math.min(maxNPCsPerBatch, MAX_NPCS_FOR_OUTPUT);

    // Reduce batch size for OpenAI models to account for combined input+output limits
    if (isOpenAIModel) {
      // Reserve more tokens for output by reducing batch size
      maxNPCsPerBatch = Math.max(1, Math.floor(maxNPCsPerBatch * 0.5)); // 50% reduction for safety
    }

    logger.info(
      'Token budget allocation',
      {
        maxContextTokens: this.tokenConfig.maxContextTokens,
        tokensPerNPC: this.tokenConfig.tokensPerNPC,
        maxNPCsPerBatch,
        totalNPCs: npcs.length,
        batchesNeeded: Math.ceil(npcs.length / maxNPCsPerBatch),
        isOpenAIModel,
        provider: this.llm.getProvider(),
      },
      'MarketDecisionEngine'
    );

    // Process NPCs in batches if needed
    const allDecisions: TradingDecision[] = [];

    for (let i = 0; i < npcs.length; i += maxNPCsPerBatch) {
      const batch = npcs.slice(i, i + maxNPCsPerBatch);
      const batchNum = Math.floor(i / maxNPCsPerBatch) + 1;
      const totalBatches = Math.ceil(npcs.length / maxNPCsPerBatch);

      logger.info(
        `Processing batch ${batchNum}/${totalBatches}`,
        {
          batchSize: batch.length,
          npcNames: batch.map((n) => n.npcName).join(', '),
        },
        'MarketDecisionEngine'
      );

      const batchDecisions = await this.generateDecisionsForContexts(batch);
      // Reject this batch before spending tokens on unrelated NPC batches.
      allDecisions.push(
        ...(await this.validateDecisions(batchDecisions, contexts))
      );

      // Throttle between batches to avoid exhausting TPM rate limits
      if (i + maxNPCsPerBatch < npcs.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Validate all decisions
    const validDecisions = allDecisions;

    const duration = Date.now() - startTime;
    const tradeCount = validDecisions.filter((d) => d.action !== 'hold').length;
    const holdCount = validDecisions.filter((d) => d.action === 'hold').length;

    logger.info(
      `Generated ${validDecisions.length} decisions in ${duration}ms`,
      {
        total: validDecisions.length,
        trades: tradeCount,
        holds: holdCount,
        durationMs: duration,
      },
      'MarketDecisionEngine'
    );

    return validDecisions;
  }

  /**
   * Generate decisions for specific NPCs
   */
  async generateDecisionsForNPCs(npcIds: string[]): Promise<TradingDecision[]> {
    const contexts: NPCMarketContext[] = [];

    for (const npcId of npcIds) {
      const context = await this.contextService.buildContextForNPC(npcId);
      contexts.push(context);
    }

    const decisions = await this.generateDecisionsForContexts(contexts);

    const contextsMap = new Map(contexts.map((c) => [c.npcId, c]));
    return await this.validateDecisions(decisions, contextsMap);
  }

  /**
   * Format Market Data as a structured ASCII Table.
   * Delegates to shared utility `formatMarketDataTable`.
   */
  private formatMarketTable(contexts: NPCMarketContext[]): string {
    if (!contexts[0]) return 'No Market Data Available';
    return formatMarketDataTable(contexts[0]);
  }

  private formatMarketSignals(contexts: NPCMarketContext[]): string {
    if (!contexts[0]) return '';
    const signals = contexts[0].marketSignals;
    if (!signals || signals.length === 0) return '';

    const lines = signals.map((s) => {
      const direction =
        s.suggestedOutcome === 'YES'
          ? '↑ YES'
          : s.suggestedOutcome === 'NO'
            ? '↓ NO'
            : '? UNCERTAIN';
      const conf = (s.confidence * 100).toFixed(0);
      return `- Q${s.marketId}: ${direction} (confidence: ${conf}%, signal: ${s.netSignal > 0 ? '+' : ''}${s.netSignal.toFixed(2)})`;
    });

    return `SIGNAL ANALYSIS (from feed/event content):\n${lines.join('\n')}`;
  }

  /**
   * Format NPCs list into "Trader Dashboard" blocks.
   * Delegates to shared utility `formatNPCsDashboardList`.
   */
  private formatNPCsList(contexts: NPCMarketContext[]): string {
    return formatNPCsDashboardList(contexts);
  }

  /**
   * Generate decisions for an array of contexts using LLM with token validation
   */
  private async generateDecisionsForContexts(
    contexts: NPCMarketContext[]
  ): Promise<TradingDecision[]> {
    if (contexts.length === 0) return [];

    // Format NPCs data as structured dashboard
    let npcsList = this.formatNPCsList(contexts);

    // Format Market Data Table
    const marketTable = this.formatMarketTable(contexts);

    // Get world context with caching (avoids redundant queries in same tick)
    const worldContext = await this.getCachedWorldContext();

    // Get active questions with caching (especially comparative ones)
    const activeQuestionsText = await this.getCachedActiveQuestions();

    // Get recent events with caching
    const recentEventsText = await this.getCachedRecentEvents();

    // Get event-market signals for trading context (BAB-5)
    const eventMarketSignals = await this.getCachedEventMarketSignals();
    const momentumAlerts = await this.getCachedMomentumAlerts();

    // Get resolved questions and previous trades (formerly ghost variables)
    const resolvedQuestionsContext = await this.getCachedResolvedQuestions();
    const previousTrades = await this.getCachedPreviousTrades();
    const npcIds = contexts.map((ctx) => ctx.npcId);

    // Format signal analysis from feed content for prediction markets
    const marketSignalAnalysis = this.formatMarketSignals(contexts);

    // Append NPC memories to each trader dashboard block.
    // NOTE: Coupled to formatSingleNPCDashboard() output format in trading-dashboard-format.ts.
    // The separator and "ID: <npcId>" line must stay in sync.
    const npcMemories = await this.getMemoriesForNPCs(npcIds);
    if (npcMemories.size > 0) {
      const dashboards = npcsList.split(
        '\n----------------------------------------\n'
      );
      npcsList = dashboards
        .map((dashboard) => {
          const idMatch = dashboard.match(/ID:\s*(\S+)/);
          if (idMatch?.[1]) {
            const npcId = idMatch[1];
            const memories = npcMemories.get(npcId);
            if (memories) {
              return `${dashboard}\n${memories}`;
            }
          }
          return dashboard;
        })
        .join('\n----------------------------------------\n');
    }

    // Build valid IDs/tickers for the prompt
    const validNpcIds = contexts.map((ctx) => ctx.npcId).join(', ');

    // Collect all tickers for validation/safety
    const allTickers = new Set<string>();
    contexts.forEach((ctx) => {
      ctx.perpMarkets.forEach((m) => allTickers.add(m.ticker));
    });

    const validTickers =
      allTickers.size > 0
        ? Array.from(allTickers).join(', ')
        : '(No perp markets available)';

    // Get shuffled examples for entropy
    const examples = getShuffledExamplesText();

    // Build the full prompt
    const prompt = renderPrompt(npcMarketDecisions, {
      examples,
      marketTable,
      npcCount: contexts.length.toString(),
      npcsList,
      validNpcIds,
      validTickers,
      realityGrounding: worldContext.realityGrounding,
      activeQuestions: activeQuestionsText,
      recentEvents: recentEventsText,
      richGameContext: worldContext.richGameContext || '',
      eventMarketSignals,
      momentumAlerts,
      resolvedQuestionsContext,
      previousTrades,
      marketSignalAnalysis,
    });

    // Count tokens and enforce limit
    const promptTokens = countTokensSync(prompt);

    logger.info(
      'Prompt token count',
      {
        npcs: contexts.length,
        promptTokens,
        limit: this.tokenConfig.maxContextTokens,
        withinLimit: promptTokens <= this.tokenConfig.maxContextTokens,
      },
      'MarketDecisionEngine'
    );

    // Split whole dashboards, never cut away another NPC's portfolio or identity.
    if (promptTokens > this.tokenConfig.maxContextTokens) {
      if (contexts.length === 1) {
        throw new Error(
          `Required trading context for ${contexts[0]?.npcId} exceeds token budget (${promptTokens}/${this.tokenConfig.maxContextTokens})`
        );
      }
      const midpoint = Math.ceil(contexts.length / 2);
      const first = await this.generateDecisionsForContexts(
        contexts.slice(0, midpoint)
      );
      const second = await this.generateDecisionsForContexts(
        contexts.slice(midpoint)
      );
      return [...first, ...second];
    }

    // Use XML format for more robust parsing (handles truncation better than JSON)
    // Handle OpenAI's combined input+output token limit errors by retrying with reduced output tokens
    let rawResponse:
      | TradingDecision[]
      | { decisions: TradingDecision[] | { decision: TradingDecision[] } }
      | { decision: TradingDecision[] }
      | null = null;
    const maxOutputTokens = this.tokenConfig.maxOutputTokens;
    let retryCount = 0;
    const maxRetries = 3; // Increased from 2 to 3 for better reliability

    // Build base options - only include model if explicitly set
    const baseLlmOptions: {
      temperature: number;
      maxTokens: number;
      model?: string;
      format: 'xml';
    } = {
      temperature: 0.5, // Lower temperature for trading decisions
      maxTokens: maxOutputTokens,
      format: 'xml', // Use XML for robustness
    };

    // Only pass model if it's explicitly set (let LLM client use its default otherwise)
    if (this.tokenConfig.model) {
      baseLlmOptions.model = this.tokenConfig.model;
      logger.debug(
        'Using explicit model for decision generation',
        {
          model: this.tokenConfig.model,
          provider: this.llm.getProvider(),
        },
        'MarketDecisionEngine'
      );
    } else {
      logger.debug(
        'Using LLM client default model for decision generation',
        {
          provider: this.llm.getProvider(),
        },
        'MarketDecisionEngine'
      );
    }

    while (retryCount <= maxRetries) {
      // On retry after string response, make prompt stricter
      const retryPrompt =
        retryCount > 0
          ? `⚠️⚠️⚠️ CRITICAL FORMAT REQUIREMENT - RETRY ATTEMPT ${
              retryCount + 1
            } ⚠️⚠️⚠️

You MUST respond with ONLY valid XML. NO text, NO explanations, NO reasoning, NO markdown.
Your response MUST start with <decisions> and end with </decisions>.
Your FIRST character MUST be '<' and your LAST character MUST be '>'.

❌ DO NOT return JSON.
❌ DO NOT return a 'response' object.
❌ DO NOT return columnar data (arrays of values).
✅ Return a LIST of <decision> elements inside <decisions>.

${prompt}`
          : prompt;

      // Reduce temperature on retry for more deterministic output
      const temperature =
        retryCount > 0 ? Math.max(0.3, 0.5 - retryCount * 0.1) : 0.5;

      // Configure LLM options for this attempt
      const llmOptions = {
        ...baseLlmOptions,
        temperature,
        maxTokens: maxOutputTokens,
        promptType: 'npc-market-decisions',
      };

      rawResponse = await this.llm.generateJSON<
        | TradingDecision[]
        | { decisions: TradingDecision[] | { decision: TradingDecision[] } }
        | { decision: TradingDecision[] }
      >(retryPrompt, undefined, llmOptions);

      // Validate response is not a string (which indicates LLM ignored format)
      if (typeof rawResponse === 'string') {
        logger.warn(
          'LLM returned string instead of structured data, retrying with stricter prompt',
          {
            attempt: retryCount + 1,
            preview: (rawResponse as string).substring(0, 200),
          },
          'MarketDecisionEngine'
        );

        if (retryCount < maxRetries) {
          retryCount++;
          continue; // Retry with stricter prompt
        }

        // Last retry - try to salvage by extracting XML/JSON from the string
        logger.error(
          'LLM consistently ignoring format instructions, attempting to extract data',
          {
            attempts: retryCount + 1,
          },
          'MarketDecisionEngine'
        );

        // Try to extract XML from the string response
        const xmlResult = parseXML(rawResponse as string);
        if (xmlResult.success && xmlResult.data) {
          logger.info(
            'Successfully extracted XML from string response',
            {
              hasThinkingContent: !!xmlResult.thinkingContent,
            },
            'MarketDecisionEngine'
          );
          rawResponse = xmlResult.data as typeof rawResponse;

          // Store thinking content for fallback reasoning
          if (xmlResult.thinkingContent) {
            (rawResponse as Record<string, unknown>).__thinkingContent =
              xmlResult.thinkingContent;
          }
          // Continue to structure validation below
        }
      }

      // Validate response structure matches expected format
      let isValidStructure = false;
      if (rawResponse && typeof rawResponse === 'object') {
        if (Array.isArray(rawResponse)) {
          isValidStructure = true;
        } else if ('decisions' in rawResponse || 'decision' in rawResponse) {
          isValidStructure = true;
        }
      }

      if (!isValidStructure && typeof rawResponse !== 'string') {
        // Check specifically for the columnar format to log it
        const isColumnar =
          rawResponse &&
          typeof rawResponse === 'object' &&
          'response' in rawResponse;

        logger.warn(
          `LLM returned invalid object structure${
            isColumnar ? ' (columnar format detected)' : ''
          }, retrying...`,
          {
            attempt: retryCount + 1,
            keys: rawResponse ? Object.keys(rawResponse) : [],
            isColumnar,
          },
          'MarketDecisionEngine'
        );

        if (retryCount < maxRetries) {
          retryCount++;
          continue;
        }
      }

      break; // Success, exit retry loop
    }

    // TypeScript guard: ensure rawResponse was assigned
    if (rawResponse === null) {
      logger.error(
        'Failed to generate response after all retries',
        {
          npcCount: contexts.length,
          promptTokens,
        },
        'MarketDecisionEngine'
      );
      throw new Error('Invalid or missing trading decision response');
    }

    // Extract decisions array - handle XML structure: <decisions><decision>...</decision></decisions>
    let response: TradingDecision[];
    if (Array.isArray(rawResponse)) {
      response = rawResponse;
    } else if (rawResponse && typeof rawResponse === 'object') {
      // Handle XML structure: { decisions: { decision: [...] } }
      if ('decisions' in rawResponse) {
        const decisionsObj = rawResponse.decisions;
        if (Array.isArray(decisionsObj)) {
          // Direct array
          response = decisionsObj;
        } else if (
          decisionsObj &&
          typeof decisionsObj === 'object' &&
          'decision' in decisionsObj
        ) {
          // Nested structure from XML
          const innerDecisions = (
            decisionsObj as { decision: TradingDecision[] | TradingDecision }
          ).decision;
          response = Array.isArray(innerDecisions)
            ? innerDecisions
            : [innerDecisions];
        } else {
          logger.error(
            'Invalid decisions structure',
            { decisionsObj },
            'MarketDecisionEngine'
          );
          throw new Error('Invalid or missing trading decision response');
        }
        logger.debug(
          'Extracted decisions from XML',
          {
            decisionsCount: response.length,
          },
          'MarketDecisionEngine'
        );
      } else if ('decision' in rawResponse) {
        // Handle both array and single decision object
        const decisionData = rawResponse.decision;
        if (Array.isArray(decisionData)) {
          response = decisionData;
        } else if (decisionData && typeof decisionData === 'object') {
          // Single decision object - wrap in array
          response = [decisionData as TradingDecision];
          logger.debug(
            'Wrapped single decision in array',
            {
              npcId: (decisionData as Record<string, JsonValue>).npcId,
            },
            'MarketDecisionEngine'
          );
        } else {
          logger.error(
            'Invalid decision structure',
            { decisionData },
            'MarketDecisionEngine'
          );
          throw new Error('Invalid or missing trading decision response');
        }
        logger.debug(
          'Extracted decisions from flat XML structure',
          {
            decisionsCount: response.length,
          },
          'MarketDecisionEngine'
        );
      } else {
        logger.error(
          'LLM returned object without decisions',
          {
            response: rawResponse,
            keys: Object.keys(rawResponse),
          },
          'MarketDecisionEngine'
        );
        throw new Error('Invalid or missing trading decision response');
      }
    } else {
      // Type assertion needed since rawResponse could be anything
      const responsePreview =
        typeof rawResponse === 'string'
          ? (rawResponse as string).substring(0, 200)
          : rawResponse;

      logger.error(
        'LLM returned invalid response type',
        {
          response: responsePreview,
          type: typeof rawResponse,
        },
        'MarketDecisionEngine'
      );

      // If LLM returned a string explanation, log it
      if (typeof rawResponse === 'string') {
        logger.error(
          'LLM ignored XML format and returned text explanation',
          {
            explanation: (rawResponse as string).substring(0, 300),
          },
          'MarketDecisionEngine'
        );
      }

      throw new Error('Invalid or missing trading decision response');
    }

    const returnedIds = new Set(response.map((d) => d?.npcId));
    if (
      response.length !== contexts.length ||
      returnedIds.size !== contexts.length ||
      contexts.some((c) => !returnedIds.has(c.npcId))
    ) {
      throw new Error(
        `Decision batch must return exactly one decision for each requested NPC (${response.length}/${contexts.length})`
      );
    }
    return response;
  }

  /**
   * Validate decisions against constraints
   */
  private async validateDecisions(
    decisions: TradingDecision[],
    contexts: Map<string, NPCMarketContext>
  ): Promise<TradingDecision[]> {
    return validateTradingDecisions(decisions, contexts);
  }

  /**
   * Fallback: Generate decision for a single NPC
   */
  async generateSingleDecision(npcId: string): Promise<TradingDecision> {
    const context = await this.contextService.buildContextForNPC(npcId);
    const decisions = await this.generateDecisionsForContexts([context]);

    const validated = validateTradingDecisions(
      decisions,
      new Map([[npcId, context]])
    );

    return firstOrThrow(validated, 'No decisions generated');
  }

  /**
   * Get cached world context or fetch if expired
   * Caching reduces redundant queries when processing multiple NPC batches in same tick
   */
  private async getCachedWorldContext(): Promise<
    Awaited<ReturnType<typeof generateWorldContext>>
  > {
    const now = Date.now();

    // Return cached if still valid
    if (
      this.worldContextCache &&
      now - this.worldContextCache.timestamp < this.CACHE_TTL_MS
    ) {
      logger.debug(
        'Using cached world context',
        {
          age: now - this.worldContextCache.timestamp,
        },
        'MarketDecisionEngine'
      );
      return this.worldContextCache.context;
    }

    // Fetch fresh context
    const context = await generateWorldContext({
      maxActors: 0,
      includeActors: false,
      realityGroundingLevel: 'concise',
    });

    // Cache it
    this.worldContextCache = { context, timestamp: now };
    logger.debug('Cached world context', {}, 'MarketDecisionEngine');

    return context;
  }

  /**
   * Get cached active questions or fetch if expired
   * Caching prevents redundant DB queries when processing multiple NPC batches
   */
  private async getCachedActiveQuestions(): Promise<string> {
    const now = Date.now();

    // Return cached if still valid
    if (
      this.activeQuestionsCache &&
      now - this.activeQuestionsCache.timestamp < this.CACHE_TTL_MS
    ) {
      logger.debug(
        'Using cached active questions',
        {
          age: now - this.activeQuestionsCache.timestamp,
        },
        'MarketDecisionEngine'
      );
      return this.activeQuestionsCache.questions;
    }

    // Fetch fresh questions
    const questions = await this.formatActiveQuestions();

    // Cache it
    this.activeQuestionsCache = { questions, timestamp: now };
    logger.debug('Cached active questions', {}, 'MarketDecisionEngine');

    return questions;
  }

  /**
   * Get cached recent events or fetch if expired
   * Caching prevents redundant DB queries when processing multiple NPC batches
   */
  private async getCachedRecentEvents(): Promise<string> {
    const now = Date.now();

    // Return cached if still valid
    if (
      this.recentEventsCache &&
      now - this.recentEventsCache.timestamp < this.CACHE_TTL_MS
    ) {
      logger.debug(
        'Using cached recent events',
        {
          age: now - this.recentEventsCache.timestamp,
        },
        'MarketDecisionEngine'
      );
      return this.recentEventsCache.events;
    }

    // Fetch fresh events
    const events = await this.formatRecentEvents();

    // Cache it
    this.recentEventsCache = { events, timestamp: now };
    logger.debug('Cached recent events', {}, 'MarketDecisionEngine');

    return events;
  }

  private async getCachedResolvedQuestions(): Promise<string> {
    const now = Date.now();
    if (
      this.resolvedQuestionsCache &&
      now - this.resolvedQuestionsCache.timestamp < this.CACHE_TTL_MS
    ) {
      return this.resolvedQuestionsCache.text;
    }

    if (isSimulationMode()) {
      this.resolvedQuestionsCache = { text: '', timestamp: now };
      return '';
    }

    const resolved = await db
      .select()
      .from(questions)
      .where(eq(questions.status, 'resolved'))
      .orderBy(desc(questions.resolutionDate))
      .limit(10);

    if (resolved.length === 0) {
      this.resolvedQuestionsCache = { text: '', timestamp: now };
      return '';
    }

    const text = resolved
      .filter((q) => q.resolvedOutcome != null)
      .map((q) => {
        const outcome = q.resolvedOutcome ? 'YES' : 'NO';
        return `- "${q.text}" → ${outcome}`;
      })
      .join('\n');

    this.resolvedQuestionsCache = { text, timestamp: now };
    return text;
  }

  private async getCachedPreviousTrades(): Promise<string> {
    const now = Date.now();
    if (
      this.previousTradesCache &&
      now - this.previousTradesCache.timestamp < this.CACHE_TTL_MS
    ) {
      return this.previousTradesCache.text;
    }

    if (isSimulationMode()) {
      this.previousTradesCache = { text: '', timestamp: now };
      return '';
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentTrades = await db
      .select()
      .from(npcTrades)
      .where(gte(npcTrades.executedAt, oneDayAgo))
      .orderBy(desc(npcTrades.executedAt))
      .limit(30);

    if (recentTrades.length === 0) {
      this.previousTradesCache = { text: '', timestamp: now };
      return '';
    }

    const text = recentTrades
      .map((t) => {
        const symbol = t.ticker || `Q${t.marketId}`;
        const name =
          StaticDataRegistry.getActor(t.npcActorId)?.name ?? t.npcActorId;
        return `- ${name}: ${t.action} ${symbol} $${t.amount.toFixed(0)} @ $${t.price.toFixed(2)}${t.reason ? ` (${t.reason})` : ''}`;
      })
      .join('\n');

    this.previousTradesCache = { text, timestamp: now };
    return text;
  }

  private async getMemoriesForNPCs(
    npcIds: string[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (npcIds.length === 0) return result;

    try {
      // Single batched query instead of N round trips
      const states = await db
        .select({
          id: actorState.id,
          recentMemories: actorState.recentMemories,
        })
        .from(actorState)
        .where(inArray(actorState.id, npcIds));

      for (const state of states) {
        if (!state.recentMemories) continue;
        const memories = this.memoryService.getRecentMemoriesFromRaw(
          state.recentMemories,
          state.id,
          8
        );
        const formatted = this.memoryService.formatMemoriesForPrompt(memories);
        if (formatted) {
          result.set(state.id, formatted);
        }
      }
    } catch (error) {
      logger.warn(
        'Failed to batch-fetch NPC memories',
        { error: formatError(error), npcCount: npcIds.length },
        'MarketDecisionEngine'
      );
      throw error;
    }

    return result;
  }

  /**
   * Format active questions for trading context
   * Especially important for comparative questions like "Will X outperform Y?"
   */
  private async formatActiveQuestions(): Promise<string> {
    // Simulation Mode Bypass - uses centralized constants from config/simulation.ts
    if (isSimulationMode()) {
      return `Active Questions:\n${formatSimulationPredictionMarkets()}`;
    }

    const questionsList = await db
      .select()
      .from(questions)
      .where(eq(questions.status, 'active'))
      .orderBy(desc(questions.createdAt))
      .limit(10);

    if (questionsList.length === 0) {
      return 'No active prediction questions currently.';
    }

    const formatted = questionsList.map((q) => {
      const daysUntil = Math.ceil(
        (q.resolutionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      return `- "${q.text}" (resolves in ${daysUntil} days)`;
    });

    return formatted.join('\n');
  }

  /**
   * Format recent events from current game for trading context
   * Helps NPCs understand the narrative when making decisions
   *
   * Note: NPCs already receive recent posts in their individual context.
   * This provides high-level supplementary context for the batch.
   */
  private async formatRecentEvents(): Promise<string> {
    // Simulation Mode Bypass - uses centralized constants from config/simulation.ts
    if (isSimulationMode()) {
      return formatSimulationRecentEvents();
    }

    // Get recent posts from the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get actors from static registry
    const allActors = StaticDataRegistry.getAllActors();
    const actorMap = new Map(allActors.map((a) => [a.id, a.name]));
    const actorIds = allActors.map((a) => a.id);

    if (actorIds.length === 0) {
      return 'No actors available for narrative context.';
    }

    const recentPosts = await db
      .select({ content: posts.content, authorId: posts.authorId })
      .from(posts)
      .where(
        and(
          gte(posts.createdAt, oneDayAgo),
          inArray(posts.authorId, actorIds),
          eq(posts.type, 'post')
        )
      )
      .orderBy(desc(posts.createdAt))
      .limit(10);

    if (recentPosts.length === 0) {
      return 'No recent posts in last 24 hours.';
    }

    const events = ['Recent developments (last 24h):'];
    recentPosts.forEach((post) => {
      const name = actorMap.get(post.authorId) || 'Unknown';
      events.push(`- ${name}: ${post.content}`);
    });

    return events.join('\n');
  }

  /**
   * Get cached event-market signals or fetch if expired (BAB-5)
   * Provides context about how recent events affect prediction markets
   *
   * IMPORTANT: This function MUST never return an empty string, as eventMarketSignals
   * is a required variable in the npc-market-decisions prompt template.
   */
  private async getCachedEventMarketSignals(): Promise<string> {
    const now = Date.now();
    const FALLBACK_SIGNALS =
      'EVENT-MARKET SIGNALS (recent events affecting markets):\n- None';

    // Return cached if still valid (and non-empty)
    if (
      this.eventMarketSignalsCache &&
      now - this.eventMarketSignalsCache.timestamp < this.CACHE_TTL_MS
    ) {
      const cached = this.eventMarketSignalsCache.signals;
      // Ensure cached value is not empty
      if (cached && cached.trim().length > 0) {
        logger.debug(
          'Using cached event-market signals',
          { age: now - this.eventMarketSignalsCache.timestamp },
          'MarketDecisionEngine'
        );
        return cached;
      }
      // Cache was empty, invalidate and refetch
      logger.warn(
        'Cached event-market signals was empty, refetching',
        {},
        'MarketDecisionEngine'
      );
    }

    // Simulation mode bypass - uses centralized constants from config/simulation.ts
    if (isSimulationMode()) {
      const signals = formatSimulationEventMarketSignals();
      // Ensure simulation signals are non-empty
      const validSignals =
        signals && signals.trim().length > 0 ? signals : FALLBACK_SIGNALS;
      this.eventMarketSignalsCache = { signals: validSignals, timestamp: now };
      return validSignals;
    }

    // Fetch fresh event-market summaries
    let signals: string;
    try {
      const summaries =
        await EventMarketLinkerService.getMarketEventSummaries(24);
      signals = EventMarketLinkerService.formatForTradingContext(summaries);
    } catch (error) {
      logger.warn(
        'Failed to fetch event-market signals',
        { error: formatError(error) },
        'MarketDecisionEngine'
      );
      throw error;
    }

    // Final safety check: ensure we never return empty string
    if (!signals || signals.trim().length === 0) {
      throw new Error(
        'Event-market signal formatter returned missing required context'
      );
    }

    // Cache it
    this.eventMarketSignalsCache = { signals, timestamp: now };
    logger.debug(
      'Cached event-market signals',
      { signalsLength: signals.length },
      'MarketDecisionEngine'
    );

    return signals;
  }

  /**
   * Get cached momentum alerts or fetch if expired.
   * Provides cascade/herd behavior context for trading decisions.
   */
  private async getCachedMomentumAlerts(): Promise<string> {
    const now = Date.now();
    const FALLBACK_ALERTS = '(No active momentum alerts - markets stable)';

    if (
      this.momentumAlertsCache &&
      now - this.momentumAlertsCache.timestamp < this.CACHE_TTL_MS
    ) {
      return this.momentumAlertsCache.alerts;
    }

    let alerts: string;
    try {
      alerts = await MarketMomentumService.getMomentumPromptContext();
      if (!alerts || alerts.trim().length === 0) {
        alerts = FALLBACK_ALERTS;
      }
    } catch (error) {
      logger.warn(
        'Failed to fetch momentum alerts',
        { error: formatError(error) },
        'MarketDecisionEngine'
      );
      throw error;
    }

    this.momentumAlertsCache = { alerts, timestamp: now };
    return alerts;
  }

  /**
   * Clear all caches
   * Call this when you want to force fresh data on next query
   */
  clearCaches(): void {
    this.worldContextCache = null;
    this.activeQuestionsCache = null;
    this.recentEventsCache = null;
    this.resolvedQuestionsCache = null;
    this.previousTradesCache = null;
    this.eventMarketSignalsCache = null;
    this.momentumAlertsCache = null;
    logger.debug('Cleared all caches', {}, 'MarketDecisionEngine');
  }
}
