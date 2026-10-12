import { z } from 'zod';
import type { NPCMarketContext } from '../types/market-context';
import type { TradingDecision } from '../types/market-decisions';

const decisionSchema = z.object({
  npcId: z.string().min(1),
  npcName: z.string().min(1),
  action: z.enum([
    'open_long',
    'open_short',
    'buy_yes',
    'buy_no',
    'sell_yes',
    'sell_no',
    'close_position',
    'hold',
    'wait',
  ]),
  marketType: z.enum(['perp', 'prediction']).nullable(),
  ticker: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  marketId: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  positionId: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  amount: z.number().finite().nonnegative(),
  confidence: z.number().finite().min(0).max(1),
  reasoning: z.string().trim().min(1),
});

/** Reject the whole decision set before executing any trade; never repair intent. */
export function validateTradingDecisions(
  decisions: TradingDecision[],
  contexts: Map<string, NPCMarketContext>
): TradingDecision[] {
  const seen = new Set<string>();
  return decisions.map((raw) => {
    const decision = decisionSchema.parse(raw);
    const context = contexts.get(decision.npcId);
    if (!context) throw new Error(`Unknown NPC ID ${decision.npcId}`);
    if (seen.has(decision.npcId))
      throw new Error(`Duplicate decision for ${decision.npcId}`);
    seen.add(decision.npcId);
    if (
      !Number.isFinite(context.availableBalance) ||
      context.availableBalance < 0
    ) {
      throw new Error(`Invalid required balance for ${decision.npcId}`);
    }
    const result: TradingDecision = {
      ...decision,
      npcName: context.npcName,
      timestamp: new Date().toISOString(),
    };
    if (decision.action === 'hold' || decision.action === 'wait') {
      if (decision.amount !== 0 || decision.marketType !== null)
        throw new Error('Hold/wait requires amount 0 and marketType null');
      return result;
    }
    if (decision.action === 'close_position') {
      const position = context.currentPositions.find(
        (p) => p.id === decision.positionId
      );
      if (!position)
        throw new Error(
          `Unknown close position ${decision.positionId} for ${decision.npcId}`
        );
      if (decision.marketType !== position.marketType)
        throw new Error('Close marketType does not match position');
      if (decision.amount !== 0)
        throw new Error('Close position requires amount 0');
      return {
        ...result,
        ticker: position.ticker,
        marketId: position.marketId,
      };
    }
    const prediction = ['buy_yes', 'buy_no', 'sell_yes', 'sell_no'].includes(
      decision.action
    );
    if (decision.marketType !== (prediction ? 'prediction' : 'perp'))
      throw new Error('Trade action and marketType disagree');
    if (prediction) {
      const market = context.predictionMarkets.find(
        (m) => m.id === decision.marketId
      );
      if (!market)
        throw new Error(`Unknown prediction market ${decision.marketId}`);
      if (decision.action === 'buy_yes' || decision.action === 'buy_no') {
        if (!Number.isFinite(market.maxSafeBet) || market.maxSafeBet < 0)
          throw new Error(`Missing/invalid maxSafeBet for ${market.id}`);
        if (decision.amount > market.maxSafeBet)
          throw new Error(
            `Trade amount exceeds maxSafeBet ${market.maxSafeBet} for ${market.id}`
          );
      }
    } else if (!context.perpMarkets.some((m) => m.ticker === decision.ticker)) {
      throw new Error(`Unknown perp ticker ${decision.ticker}`);
    }
    if (decision.action === 'sell_yes' || decision.action === 'sell_no') {
      if (decision.amount !== 0)
        throw new Error('Prediction sell requires amount 0 (sell all)');
      const side = decision.action === 'sell_yes' ? 'YES' : 'NO';
      const position = context.currentPositions.find(
        (p) =>
          p.marketType === 'prediction' &&
          p.marketId === decision.marketId &&
          p.side === side
      );
      if (!position)
        throw new Error(`No held ${side} position for ${decision.marketId}`);
      if (decision.positionId && decision.positionId !== position.id)
        throw new Error('Sell positionId disagrees with market and side');
      result.positionId = position.id;
    } else if (
      decision.amount <= 0 ||
      decision.amount > context.availableBalance
    ) {
      throw new Error(
        `Trade amount ${decision.amount} is invalid or exceeds balance ${context.availableBalance}`
      );
    }
    return result;
  });
}
