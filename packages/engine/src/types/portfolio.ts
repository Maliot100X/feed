/**
 * Portfolio P&L snapshot (type only, client-safe).
 */

export interface PortfolioPnLSnapshot {
  lifetimePnL: number;
  netContributions: number;
  netPeerTransfers: number;
  totalDeposited: number;
  totalWithdrawn: number;
  availableBalance: number;
  unrealizedPerpPnL: number;
  unrealizedPredictionPnL: number;
  totalUnrealizedPnL: number;
  totalPnL: number;
  accountEquity: number;
}
