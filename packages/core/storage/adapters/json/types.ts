/**
 * JSON Storage Types
 *
 * Internal types for the JSON file storage adapter.
 */

import type {
  AgentLogRecord,
  AgentMessageRecord,
  AgentPointsTransactionRecord,
} from '../../ports/agents';
import type { PointsTransactionRecord } from '../../ports/users';
import type {
  ActorRecord,
  ActorStateRecord,
  AgentConfigRecord,
  AgentTradeRecord,
  GameRecord,
  MarketSnapshotRecord,
  NpcTradeRecord,
  OrganizationRecord,
  OrganizationStateRecord,
  PoolPositionRecord,
  PoolRecord,
  PostRecord,
  PredictionMarketRecord,
  QuestionRecord,
  StockPriceRecord,
  UserRecord,
  WorldEventRecord,
} from '../../types';

/**
 * Complete storage state that can be serialized to JSON.
 */
export interface JsonStorageState {
  metadata: {
    version: string;
    createdAt: string;
    updatedAt: string;
    mode: 'simulation' | 'training' | 'debug';
  };

  // Core entities
  actors: Record<string, ActorRecord>;
  actorStates: Record<string, ActorStateRecord>;
  organizations: Record<string, OrganizationRecord>;
  organizationStates: Record<string, OrganizationStateRecord>;

  // Users and agents
  users: Record<string, UserRecord>;
  agentConfigs: Record<string, AgentConfigRecord>;
  agentLogs: AgentLogRecord[];
  agentMessages: AgentMessageRecord[];
  agentPointsTransactions: AgentPointsTransactionRecord[];
  agentTrades: AgentTradeRecord[];
  pointsTransactions: PointsTransactionRecord[];

  // Content
  posts: Record<string, PostRecord>;

  // Questions and markets
  questions: Record<string, QuestionRecord>;
  markets: Record<string, PredictionMarketRecord>;
  marketSnapshots: MarketSnapshotRecord[];

  // Trading
  pools: Record<string, PoolRecord>;
  positions: Record<string, PoolPositionRecord>;
  npcTrades: NpcTradeRecord[];

  // Game state
  game: GameRecord | null;
  worldEvents: WorldEventRecord[];
  stockPrices: StockPriceRecord[];

  // Counters for ID generation
  counters: {
    post: number;
    question: number;
    market: number;
    position: number;
    trade: number;
    event: number;
    snapshot: number;
    log: number;
    message: number;
    transaction: number;
  };
}

/**
 * Default empty state.
 */
export function createEmptyState(): JsonStorageState {
  return {
    metadata: {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: 'simulation',
    },
    actors: {},
    actorStates: {},
    organizations: {},
    organizationStates: {},
    users: {},
    agentConfigs: {},
    agentLogs: [],
    agentMessages: [],
    agentPointsTransactions: [],
    agentTrades: [],
    pointsTransactions: [],
    posts: {},
    questions: {},
    markets: {},
    marketSnapshots: [],
    pools: {},
    positions: {},
    npcTrades: [],
    game: null,
    worldEvents: [],
    stockPrices: [],
    counters: {
      post: 0,
      question: 0,
      market: 0,
      position: 0,
      trade: 0,
      event: 0,
      snapshot: 0,
      log: 0,
      message: 0,
      transaction: 0,
    },
  };
}

type DateKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Date ? K : never;
}[keyof T];

function reviveDateFields<T extends object>(
  collection: string,
  record: T,
  fields: readonly DateKeys<T>[]
): void {
  const target = record as Record<
    DateKeys<T>,
    Date | string | null | undefined
  >;
  for (const field of fields) {
    const value = target[field];
    if (typeof value !== 'string') continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(
        `Invalid date in JSON storage snapshot: ${collection}.${String(field)} = ${JSON.stringify(value)}`
      );
    }
    target[field] = date;
  }
}

function reviveMap<T extends object>(
  collection: string,
  records: Record<string, T> | undefined,
  fields: readonly DateKeys<T>[]
): void {
  if (!records) return;
  for (const record of Object.values(records)) {
    reviveDateFields(collection, record, fields);
  }
}

function reviveList<T extends object>(
  collection: string,
  records: T[] | undefined,
  fields: readonly DateKeys<T>[]
): void {
  if (!records) return;
  for (const record of records) {
    reviveDateFields(collection, record, fields);
  }
}

/**
 * Parse a serialized JSON storage snapshot, restoring the declared `Date`
 * fields of every record collection. Only fields typed as `Date` on the
 * record types are converted; free-form strings (post content, messages,
 * metadata timestamps) are left untouched.
 */
export function parseJsonStorageState(json: string): Partial<JsonStorageState> {
  const state = JSON.parse(json) as Partial<JsonStorageState>;

  reviveMap('actorStates', state.actorStates, ['updatedAt']);
  reviveMap('organizationStates', state.organizationStates, ['updatedAt']);
  reviveMap('users', state.users, ['createdAt', 'updatedAt']);
  reviveMap('agentConfigs', state.agentConfigs, ['updatedAt']);
  reviveList('agentLogs', state.agentLogs, ['createdAt']);
  reviveList('agentMessages', state.agentMessages, ['createdAt']);
  reviveList('agentPointsTransactions', state.agentPointsTransactions, [
    'createdAt',
  ]);
  reviveList('agentTrades', state.agentTrades, ['createdAt']);
  reviveList('pointsTransactions', state.pointsTransactions, ['createdAt']);
  reviveMap('posts', state.posts, ['timestamp', 'deletedAt']);
  reviveMap('questions', state.questions, [
    'resolutionDate',
    'createdAt',
    'updatedAt',
  ]);
  reviveMap('markets', state.markets, ['endDate', 'createdAt']);
  reviveList('marketSnapshots', state.marketSnapshots, ['timestamp']);
  reviveMap('pools', state.pools, ['openedAt', 'updatedAt']);
  reviveMap('positions', state.positions, [
    'openedAt',
    'closedAt',
    'updatedAt',
  ]);
  reviveList('npcTrades', state.npcTrades, ['createdAt']);
  if (state.game) {
    reviveDateFields('game', state.game, [
      'currentDate',
      'lastTickAt',
      'lastSnapshotAt',
      'createdAt',
      'updatedAt',
    ]);
  }
  reviveList('worldEvents', state.worldEvents, ['timestamp']);
  reviveList('stockPrices', state.stockPrices, ['timestamp']);

  return state;
}
