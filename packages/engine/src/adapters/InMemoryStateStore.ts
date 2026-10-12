/**
 * In-memory state store for simulation/training.
 * Implements GameStateStore interface without database dependencies.
 * Provides full game simulation capabilities.
 */

import {
  PREDICTION_TEMPLATES,
  SIMULATION_AGENT_NAMES,
  SIMULATION_COMPANIES,
} from '../config/simulation';
import { SeededRandom } from '../utils/entropy';
import type {
  ActiveMarket,
  ActiveQuestion,
  ArticleInput,
  EventInput,
  GameActor,
  GameOrganization,
  GameStateStore,
  Position,
  PostInput,
  QuestionInput,
  TradeInput,
  TradeResult,
} from './game-state-store';

export interface SimulationConfig {
  numPredictionMarkets?: number;
  numPerpMarkets?: number;
  numAgents?: number;
  durationDays?: number;
  seed?: number;
  startingBalance?: number;
}

export interface SimulationUser {
  id: string;
  name: string;
  balance: number;
  totalPnl: number;
  predictionPositions: PredictionPosition[];
  perpPositions: PerpPosition[];
}

export interface PredictionPosition {
  id: string;
  marketId: string;
  outcome: 'YES' | 'NO';
  shares: number;
  avgPrice: number;
  createdAt: number;
}

export interface PerpPosition {
  id: string;
  ticker: string;
  side: 'LONG' | 'SHORT';
  size: number;
  leverage: number;
  entryPrice: number;
  liquidationPrice: number;
  unrealizedPnl: number;
  createdAt: number;
}

export interface PerpMarket {
  ticker: string;
  name: string;
  price: number;
  previousPrice: number;
  priceChange24h: number;
  volume24h: number;
  openInterest: number;
  fundingRate: number;
  volatility: number;
}

export interface SimulationPost {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  likes: number;
  comments: number;
  marketId?: string;
}

export interface SimulationEvent {
  id: string;
  type: string;
  description: string;
  day: number;
  hour: number;
  visibility: string;
  pointsToward?: string;
  relatedQuestion?: number;
}

interface StoredQuestion extends ActiveQuestion {
  createdAt: Date;
  resolvesOnDay?: number;
}

interface StoredMarket extends ActiveMarket {
  question: string;
  description: string;
  liquidity: number;
  totalVolume: number;
  createdAt: number;
  resolveAt: number;
  resolvesOnDay: number;
}

// Use shared simulation constants
const COMPANIES = SIMULATION_COMPANIES;
const NPC_NAMES = SIMULATION_AGENT_NAMES;

export class InMemoryStateStore implements GameStateStore {
  private questions: Map<string, StoredQuestion> = new Map();
  private markets: Map<string, StoredMarket> = new Map();
  private perpMarkets: Map<string, PerpMarket> = new Map();
  private postsList: SimulationPost[] = [];
  private events: SimulationEvent[] = [];
  private actorsList: GameActor[] = [];
  private organizationsList: GameOrganization[] = [];
  private users: Map<string, SimulationUser> = new Map();
  private marketOutcomes: Map<string, boolean> = new Map();

  private nextId = 1;
  private currentTick = 0;
  private currentDay = 1;
  private currentHour = 0;
  private rng: SeededRandom;
  private config: Required<SimulationConfig>;

  constructor(config: SimulationConfig = {}) {
    for (const key of [
      'numPredictionMarkets',
      'numPerpMarkets',
      'numAgents',
      'durationDays',
    ] as const) {
      const value = config[key];
      if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
        throw new Error(`Invalid simulation config ${key}: ${value}`);
      }
    }
    if (config.durationDays !== undefined && config.durationDays < 1) {
      throw new Error('Invalid simulation config durationDays: must be >= 1');
    }
    if (
      config.startingBalance !== undefined &&
      (!Number.isFinite(config.startingBalance) || config.startingBalance < 0)
    ) {
      throw new Error(
        `Invalid simulation config startingBalance: ${config.startingBalance}`
      );
    }
    this.config = {
      numPredictionMarkets: config.numPredictionMarkets ?? 5,
      numPerpMarkets: config.numPerpMarkets ?? 5,
      numAgents: config.numAgents ?? 10,
      durationDays: config.durationDays ?? 30,
      seed: config.seed ?? Date.now(),
      startingBalance: config.startingBalance ?? 10000,
    };
    this.rng = new SeededRandom(this.config.seed);
    this.initialize();
  }

  private initialize(): void {
    this.createPredictionMarkets();
    this.createPerpMarkets();
    this.createAgents();
  }

  private generateId(): string {
    return `sim-${this.nextId++}`;
  }

  private createPredictionMarkets(): void {
    for (let i = 0; i < this.config.numPredictionMarkets; i++) {
      const template = this.rng.pick(PREDICTION_TEMPLATES);
      const company = this.rng.pick(COMPANIES);
      const target = this.rng.nextInt(100, 500);
      const question = template.q
        .replace('{company}', company.name)
        .replace('{target}', target.toString())
        .replace('{sector}', company.sector);

      const id = `market-${i + 1}`;
      // Resolution day within the simulation (day 15+ when the run is long enough)
      const earliestResolution = Math.min(15, this.config.durationDays);
      const resolvesOnDay = this.rng.nextInt(
        earliestResolution,
        this.config.durationDays
      );
      const yesShares = this.rng.nextFloat(5000, 15000);
      const noShares = this.rng.nextFloat(5000, 15000);
      // Price is derived from reserves with the same rule used after trades,
      // so the first trade does not jump to an unrelated price.
      const yesPrice = yesShares / (yesShares + noShares);

      this.markets.set(id, {
        id,
        questionNumber: i + 1,
        yesShares,
        noShares,
        yesPrice,
        noPrice: 1 - yesPrice,
        resolved: false,
        question,
        description: template.desc,
        liquidity: this.rng.nextFloat(5000, 20000),
        totalVolume: this.rng.nextFloat(10000, 100000),
        createdAt: Date.now(),
        resolveAt: Date.now() + resolvesOnDay * 24 * 60 * 60 * 1000,
        resolvesOnDay,
      });

      // Pre-determine outcome
      this.marketOutcomes.set(id, this.rng.next() > 0.5);
    }
  }

  private createPerpMarkets(): void {
    const companies = COMPANIES.slice(0, this.config.numPerpMarkets);
    for (const company of companies) {
      const price = this.rng.nextFloat(50, 500);
      this.perpMarkets.set(company.ticker, {
        ticker: company.ticker,
        name: company.name,
        price,
        previousPrice: price,
        priceChange24h: 0,
        volume24h: this.rng.nextFloat(100000, 1000000),
        openInterest: this.rng.nextFloat(50000, 500000),
        fundingRate: this.rng.nextFloat(-0.01, 0.01),
        volatility: this.rng.nextFloat(0.02, 0.08),
      });
    }
  }

  private createAgents(): void {
    for (let i = 0; i < this.config.numAgents; i++) {
      const name = NPC_NAMES[i % NPC_NAMES.length] ?? `Agent ${i + 1}`;
      const id = `npc-${i + 1}`;

      this.actorsList.push({ id, name, tier: 'supporting' });
      this.users.set(id, {
        id,
        name,
        balance: this.rng.nextFloat(5000, 50000),
        totalPnl: 0,
        predictionPositions: [],
        perpPositions: [],
      });
    }
  }

  // GameStateStore interface implementation
  async getActiveQuestions(): Promise<ActiveQuestion[]> {
    return Array.from(this.questions.values()).filter(
      (q) => q.status === 'active'
    );
  }

  async getQuestionsToResolve(beforeTime: Date): Promise<ActiveQuestion[]> {
    return Array.from(this.questions.values()).filter(
      (q) =>
        q.status === 'active' &&
        q.resolutionDate &&
        q.resolutionDate <= beforeTime
    );
  }

  async createQuestion(question: QuestionInput): Promise<string> {
    const id = this.generateId();
    const questionNumber = this.questions.size + 1;
    this.questions.set(id, {
      id,
      questionNumber,
      text: question.text,
      status: 'active',
      resolutionDate: question.resolutionDate,
      scenarioId: question.scenarioId,
      createdAt: new Date(),
    });
    return id;
  }

  async resolveQuestion(questionId: string, outcome: boolean): Promise<void> {
    const question = this.questions.get(questionId);
    const market = this.markets.get(questionId);
    if (!question && !market) {
      throw new Error(`Cannot resolve unknown question/market: ${questionId}`);
    }
    if (question) {
      question.status = 'resolved';
      question.outcome = outcome;
    }
    if (market) {
      this.settleMarket(questionId, market, outcome);
    }
  }

  /**
   * Resolve a prediction market and pay out positions (idempotent: a market
   * that is already resolved is not settled again). Winning shares pay 1.
   */
  private settleMarket(
    marketId: string,
    market: StoredMarket,
    outcome: boolean
  ): void {
    if (market.resolved) return;
    market.resolved = true;
    market.yesPrice = outcome ? 1 : 0;
    market.noPrice = outcome ? 0 : 1;

    const winningSide = outcome ? 'YES' : 'NO';
    for (const user of this.users.values()) {
      const remaining: PredictionPosition[] = [];
      for (const pos of user.predictionPositions) {
        if (pos.marketId !== marketId) {
          remaining.push(pos);
          continue;
        }
        const payout = pos.outcome === winningSide ? pos.shares : 0;
        user.balance += payout;
        user.totalPnl += payout - pos.shares * pos.avgPrice;
      }
      user.predictionPositions = remaining;
    }
  }

  async getActiveMarkets(): Promise<ActiveMarket[]> {
    return Array.from(this.markets.values()).filter((m) => !m.resolved);
  }

  async updateMarketPrice(
    marketId: string,
    yesPrice: number,
    noPrice: number
  ): Promise<void> {
    const market = this.markets.get(marketId);
    if (market) {
      market.yesPrice = yesPrice;
      market.noPrice = noPrice;
    }
  }

  async createPost(post: PostInput): Promise<string> {
    const id = this.generateId();
    const author = this.users.get(post.authorId);
    this.postsList.push({
      id,
      authorId: post.authorId,
      authorName: author?.name ?? 'Unknown',
      content: post.content,
      createdAt: post.timestamp.getTime(),
      likes: 0,
      comments: 0,
    });
    return id;
  }

  async createEvent(event: EventInput): Promise<string> {
    const id = this.generateId();
    this.events.push({
      id,
      type: event.type,
      description: event.description,
      day: event.day,
      hour: event.hour,
      visibility: event.visibility,
      pointsToward: event.pointsToward,
      relatedQuestion: event.relatedQuestion,
    });
    return id;
  }

  async createArticle(article: ArticleInput): Promise<string> {
    return this.createPost({
      authorId: article.authorOrgId,
      content: article.content,
      type: 'article',
      timestamp: article.timestamp,
    });
  }

  async getActors(limit?: number): Promise<GameActor[]> {
    const actors = this.actorsList.map((a) => ({ ...a }));
    return limit === undefined ? actors : actors.slice(0, limit);
  }

  async getOrganizations(): Promise<GameOrganization[]> {
    return this.organizationsList.map((o) => ({ ...o }));
  }

  async executeTrade(trade: TradeInput): Promise<TradeResult> {
    return this.buyPredictionShares(
      trade.actorId,
      trade.marketId,
      trade.side,
      trade.amount
    );
  }

  async getPositions(actorId: string): Promise<Position[]> {
    const user = this.users.get(actorId);
    if (!user) return [];
    return user.predictionPositions.map((p) => ({
      marketId: p.marketId,
      side: p.outcome,
      shares: p.shares,
      avgPrice: p.avgPrice,
    }));
  }

  // Extended simulation methods
  getOrCreateUser(userId: string): SimulationUser {
    let user = this.users.get(userId);
    if (!user) {
      user = {
        id: userId,
        name: `User ${userId.slice(-4)}`,
        balance: this.config.startingBalance,
        totalPnl: 0,
        predictionPositions: [],
        perpPositions: [],
      };
      this.users.set(userId, user);
    }
    return user;
  }

  buyPredictionShares(
    userId: string,
    marketId: string,
    outcome: 'YES' | 'NO',
    amount: number
  ): TradeResult {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: 'Amount must be a positive number' };
    }
    const user = this.getOrCreateUser(userId);
    const market = this.markets.get(marketId);
    if (!market) return { success: false, error: 'Market not found' };
    if (market.resolved) return { success: false, error: 'Market is resolved' };
    if (user.balance < amount)
      return { success: false, error: 'Insufficient balance' };

    const price = outcome === 'YES' ? market.yesPrice : market.noPrice;
    if (!Number.isFinite(price) || price <= 0) {
      return { success: false, error: 'No valid price for outcome' };
    }
    const shares = amount / price;

    user.balance -= amount;
    user.predictionPositions.push({
      id: this.generateId(),
      marketId,
      outcome,
      shares,
      avgPrice: price,
      createdAt: Date.now(),
    });

    // Update market
    if (outcome === 'YES') market.yesShares += shares;
    else market.noShares += shares;
    market.totalVolume += amount;
    const total = market.yesShares + market.noShares;
    market.yesPrice = market.yesShares / total;
    market.noPrice = market.noShares / total;

    return { success: true, shares, price, totalCost: amount };
  }

  sellPredictionShares(
    userId: string,
    marketId: string,
    outcome: 'YES' | 'NO',
    shares: number
  ): TradeResult {
    if (!Number.isFinite(shares) || shares <= 0) {
      return { success: false, error: 'Shares must be a positive number' };
    }
    const user = this.users.get(userId);
    if (!user) return { success: false, error: 'User not found' };

    const market = this.markets.get(marketId);
    if (!market) return { success: false, error: 'Market not found' };
    if (market.resolved) return { success: false, error: 'Market is resolved' };

    // Same-side holdings may be split across several positions (one per buy)
    const holdings = user.predictionPositions.filter(
      (p) => p.marketId === marketId && p.outcome === outcome
    );
    const held = holdings.reduce((sum, p) => sum + p.shares, 0);
    if (holdings.length === 0 || held < shares) {
      return { success: false, error: 'Position not found' };
    }

    const price = outcome === 'YES' ? market.yesPrice : market.noPrice;
    const proceeds = shares * price;

    // Consume FIFO and realize PnL against each lot's cost basis
    let toSell = shares;
    let costBasis = 0;
    for (const pos of holdings) {
      if (toSell <= 0) break;
      const sold = Math.min(pos.shares, toSell);
      pos.shares -= sold;
      costBasis += sold * pos.avgPrice;
      toSell -= sold;
    }
    user.predictionPositions = user.predictionPositions.filter(
      (p) => p.shares > 0
    );
    user.balance += proceeds;
    user.totalPnl += proceeds - costBasis;

    // Shares return to the pool: update reserves, volume and price
    if (outcome === 'YES') market.yesShares -= shares;
    else market.noShares -= shares;
    market.totalVolume += proceeds;
    const total = market.yesShares + market.noShares;
    if (total > 0) {
      market.yesPrice = market.yesShares / total;
      market.noPrice = market.noShares / total;
    }

    return { success: true, shares, price, totalCost: proceeds };
  }

  openPerpPosition(
    userId: string,
    ticker: string,
    side: 'LONG' | 'SHORT',
    size: number,
    leverage: number
  ): TradeResult & { positionId?: string } {
    if (!Number.isFinite(size) || size <= 0) {
      return { success: false, error: 'Size must be a positive number' };
    }
    if (!Number.isFinite(leverage) || leverage < 1) {
      return { success: false, error: 'Leverage must be >= 1' };
    }
    const user = this.getOrCreateUser(userId);
    const market = this.perpMarkets.get(ticker);
    if (!market) return { success: false, error: 'Market not found' };

    // `size` is notional (quote currency); margin posted is notional/leverage
    const margin = size / leverage;
    if (user.balance < margin)
      return { success: false, error: 'Insufficient balance' };

    const positionId = this.generateId();
    const liquidationPrice =
      side === 'LONG'
        ? market.price * (1 - 1 / leverage)
        : market.price * (1 + 1 / leverage);

    user.balance -= margin;
    user.perpPositions.push({
      id: positionId,
      ticker,
      side,
      size,
      leverage,
      entryPrice: market.price,
      liquidationPrice,
      unrealizedPnl: 0,
      createdAt: Date.now(),
    });

    return { success: true, positionId, price: market.price };
  }

  closePerpPosition(userId: string, positionId: string): TradeResult {
    const user = this.users.get(userId);
    if (!user) return { success: false, error: 'User not found' };

    const posIndex = user.perpPositions.findIndex((p) => p.id === positionId);
    if (posIndex === -1) return { success: false, error: 'Position not found' };

    const pos = user.perpPositions[posIndex]!;
    const market = this.perpMarkets.get(pos.ticker);
    if (!market) return { success: false, error: 'Market not found' };

    // size is notional, so PnL is notional x relative price move
    const priceReturn = market.price / pos.entryPrice - 1;
    const pnl =
      pos.side === 'LONG' ? pos.size * priceReturn : -pos.size * priceReturn;

    const margin = pos.size / pos.leverage;
    user.balance += margin + pnl;
    user.totalPnl += pnl;
    user.perpPositions.splice(posIndex, 1);

    return { success: true, totalCost: pnl };
  }

  createUserPost(userId: string, content: string): SimulationPost {
    const user = this.getOrCreateUser(userId);
    const post: SimulationPost = {
      id: this.generateId(),
      authorId: userId,
      authorName: user.name,
      content,
      createdAt: Date.now(),
      likes: 0,
      comments: 0,
    };
    this.postsList.push(post);
    return post;
  }

  // Simulation state access
  getState() {
    return {
      tick: this.currentTick,
      day: this.currentDay,
      hour: this.currentHour,
      predictionMarkets: Array.from(this.markets.values()),
      perpMarkets: Array.from(this.perpMarkets.values()),
      agents: Array.from(this.users.values()),
      posts: this.postsList,
      events: this.events,
    };
  }

  advanceTick(): void {
    this.currentTick++;
    this.currentHour++;
    if (this.currentHour >= 24) {
      this.currentHour = 0;
      this.currentDay++;
      this.checkMarketResolutions();
    }
    this.updatePerpPrices();
  }

  private checkMarketResolutions(): void {
    for (const [id, market] of this.markets) {
      if (!market.resolved && this.currentDay >= market.resolvesOnDay) {
        const outcome = this.marketOutcomes.get(id);
        if (outcome === undefined) {
          throw new Error(`Missing predetermined outcome for market ${id}`);
        }
        this.settleMarket(id, market, outcome);
      }
    }
  }

  private updatePerpPrices(): void {
    for (const market of this.perpMarkets.values()) {
      const change = this.rng.nextFloat(-market.volatility, market.volatility);
      market.previousPrice = market.price;
      market.price *= 1 + change;
      market.priceChange24h =
        ((market.price - market.previousPrice) / market.previousPrice) * 100;
    }
  }

  isComplete(): boolean {
    return this.currentDay > this.config.durationDays;
  }

  getProgress() {
    return {
      tick: this.currentTick,
      day: this.currentDay,
      hour: this.currentHour,
      totalTicks: this.config.durationDays * 24,
    };
  }

  getGroundTruth(): Map<string, boolean> {
    return new Map(this.marketOutcomes);
  }

  getPerpMarkets(): PerpMarket[] {
    return Array.from(this.perpMarkets.values());
  }

  getPosts(): SimulationPost[] {
    return this.postsList;
  }

  getEvents(): SimulationEvent[] {
    return this.events;
  }
}
