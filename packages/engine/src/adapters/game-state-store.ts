/**
 * Game state store contract implemented by the offline InMemoryStateStore.
 * The production tick is `executeGameTick` in game-tick.ts.
 */

/** Abstract interface for game state storage */
export interface GameStateStore {
  // Questions
  getActiveQuestions(): Promise<ActiveQuestion[]>;
  getQuestionsToResolve(beforeTime: Date): Promise<ActiveQuestion[]>;
  createQuestion(question: QuestionInput): Promise<string>;
  resolveQuestion(questionId: string, outcome: boolean): Promise<void>;

  // Markets
  getActiveMarkets(): Promise<ActiveMarket[]>;
  updateMarketPrice(
    marketId: string,
    yesPrice: number,
    noPrice: number
  ): Promise<void>;

  // Content
  createPost(post: PostInput): Promise<string>;
  createEvent(event: EventInput): Promise<string>;
  createArticle(article: ArticleInput): Promise<string>;

  // Actors
  getActors(limit?: number): Promise<GameActor[]>;
  getOrganizations(): Promise<GameOrganization[]>;

  // Trading
  executeTrade(trade: TradeInput): Promise<TradeResult>;
  getPositions(actorId: string): Promise<Position[]>;
}

export interface ActiveQuestion {
  id: string;
  questionNumber: number;
  text: string;
  status: 'active' | 'resolved';
  outcome?: boolean;
  resolutionDate?: Date;
  scenarioId?: number;
}

export interface ActiveMarket {
  id: string;
  questionNumber: number;
  yesShares: number;
  noShares: number;
  yesPrice: number;
  noPrice: number;
  resolved: boolean;
}

export interface QuestionInput {
  text: string;
  resolutionDate: Date;
  scenarioId?: number;
}

export interface PostInput {
  authorId: string;
  content: string;
  type: 'post' | 'article' | 'reply';
  timestamp: Date;
}

export interface EventInput {
  type: string;
  description: string;
  day: number;
  hour: number;
  actors: string[];
  visibility: 'public' | 'leaked' | 'private';
  pointsToward?: 'YES' | 'NO';
  relatedQuestion?: number;
}

export interface ArticleInput {
  title: string;
  content: string;
  summary: string;
  authorOrgId: string;
  timestamp: Date;
  category?: string;
}

export interface GameActor {
  id: string;
  name: string;
  tier?: string;
  personality?: string;
  domain?: string[];
}

export interface GameOrganization {
  id: string;
  name: string;
  type: 'company' | 'media' | 'government';
}

export interface TradeInput {
  actorId: string;
  marketId: string;
  side: 'YES' | 'NO';
  amount: number;
}

export interface TradeResult {
  success: boolean;
  shares?: number;
  price?: number;
  totalCost?: number;
  error?: string;
}

export interface Position {
  marketId: string;
  side: 'YES' | 'NO';
  shares: number;
  avgPrice: number;
}
