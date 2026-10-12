/**
 * Agent Goals, Directives, and Constraints Type Definitions
 *
 * Defines the structure for user-configurable agent goals and autonomous behavior.
 */

/**
 * Agent Goal Types
 */
export type GoalType =
  | 'trading'
  | 'social'
  | 'learning'
  | 'reputation'
  | 'custom';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'failed';

/**
 * Goal Target Metrics
 */
export interface GoalTarget {
  metric:
    | 'pnl' // Profit & Loss target
    | 'balance' // Balance target
    | 'followers' // Follower count
    | 'posts' // Number of posts
    | 'comments' // Number of comments
    | 'win_rate' // Trading win rate
    | 'trades' // Number of trades
    | 'engagement' // Social engagement score
    | 'reputation' // Reputation points
    | 'custom'; // Custom metric
  value: number; // Target value
  current?: number; // Current value
  deadline?: Date; // Optional deadline
  unit?: string; // Unit for display (e.g., "$", "%", "followers")
}

/**
 * Complete Agent Goal Definition
 */
export interface AgentGoal {
  id: string;
  agentUserId: string;
  type: GoalType;
  name: string;
  description: string;
  target?: GoalTarget;
  priority: number; // 1-10, higher = more important
  status: GoalStatus;
  progress: number; // 0-1 (0% to 100%)
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;

  // Optional configuration
  constraints?: Partial<AgentConstraints>;
  rewards?: {
    onProgress?: string;
    onCompletion?: string;
  };
}

/**
 * Directive Types
 */
export type DirectiveType =
  | 'always' // Must always do
  | 'never' // Must never do
  | 'prefer' // Should prefer
  | 'avoid'; // Should avoid

/**
 * Agent Directive Definition
 */
export interface AgentDirective {
  id: string;
  type: DirectiveType;
  rule: string; // Short rule statement
  description: string; // Detailed explanation
  priority: number; // 1-10
  examples: string[]; // Example scenarios
  contexts?: string[]; // When this applies (e.g., ['trading', 'social'])
}

/**
 * Trading Constraints
 */
export interface TradingConstraints {
  maxPositionSize: number; // Max $ per position
  maxLeverage: number; // Max leverage multiplier
  maxOpenPositions?: number; // Max concurrent positions
  allowedMarketTypes: ('prediction' | 'perp')[];
  stopLossPercent?: number; // Auto stop-loss %
  takeProfitPercent?: number; // Auto take-profit %
  allowedTickers?: string[]; // Whitelist of tickers
  forbiddenTickers?: string[]; // Blacklist of tickers
  minConfidence?: number; // Min confidence for trades (0-1)
  maxDailyTrades?: number; // Max trades per day
}

/**
 * Social Constraints
 */
export interface SocialConstraints {
  minPostInterval: number; // Minutes between posts
  maxPostsPerDay: number; // Max posts in 24h
  maxCommentsPerDay?: number; // Max comments in 24h
  allowedTopics?: string[]; // Topic whitelist
  restrictedTopics?: string[]; // Topic blacklist
  minPostLength?: number; // Min characters
  maxPostLength?: number; // Max characters
  requireApproval?: boolean; // Require manager approval
  allowMentions?: boolean; // Can mention other users
  allowHashtags?: boolean; // Can use hashtags
}

/**
 * General Behavior Constraints
 */
export interface GeneralConstraints {
  maxActionsPerTick: number; // Max actions in one tick
  priorityWeights: {
    trading: number; // Weight for trading actions
    social: number; // Weight for social actions
    responding: number; // Weight for responses
  };
  respectQuietHours?: boolean; // Follow quiet hours
  quietHoursStart?: number; // Hour (0-23)
  quietHoursEnd?: number; // Hour (0-23)
  riskTolerance: 'low' | 'medium' | 'high'; // Overall risk appetite
}

/**
 * Complete Constraints Configuration
 */
export interface AgentConstraints {
  trading: TradingConstraints;
  social: SocialConstraints;
  general: GeneralConstraints;
}
