/**
 * Market Volatility Simulation Test
 *
 * Comprehensive integration test that simulates real game activity
 * to verify the market volatility systems work correctly.
 *
 * Tests:
 * 1. Bonding curve price impact from NPC trades
 * 2. Price cascades during panic/FOMO scenarios
 * 3. Market limits (floor, ceiling, max change) working correctly
 *
 * Fee redistribution solvency is not covered here: it must be tested
 * against the real FeeService/redistribution transactions, not a copy.
 */

import { describe, expect, it } from 'bun:test';
import {
  BONDING_CURVE_CONFIG,
  calculateBondingCurvePrice,
  calculatePriceFromHoldings,
  PERP_MARKET_CONFIG,
} from '@feed/shared';
import { MarketMomentumService } from '../../services/market-momentum-service';

/**
 * Simulates a market with price tracking over multiple trades
 */
class MarketSimulator {
  private initialPrice: number;
  private currentPrice: number;
  private netHoldings: number = 0;
  private priceHistory: number[] = [];
  private tradeHistory: Array<{
    tick: number;
    action: 'buy' | 'sell';
    amount: number;
    priceImpact: number;
    newPrice: number;
  }> = [];

  constructor(initialPrice: number) {
    this.initialPrice = initialPrice;
    this.currentPrice = initialPrice;
    this.priceHistory.push(initialPrice);
  }

  /**
   * Execute a trade and update price
   */
  trade(action: 'buy' | 'sell', amount: number, tick: number): number {
    const holdingsChange = action === 'buy' ? amount : -amount;
    this.netHoldings += holdingsChange;

    const previousPrice = this.currentPrice;
    this.currentPrice = calculatePriceFromHoldings(
      this.initialPrice,
      this.currentPrice,
      this.netHoldings,
      PERP_MARKET_CONFIG,
      BONDING_CURVE_CONFIG
    );

    const priceImpact =
      ((this.currentPrice - previousPrice) / previousPrice) * 100;

    this.priceHistory.push(this.currentPrice);
    this.tradeHistory.push({
      tick,
      action,
      amount,
      priceImpact,
      newPrice: this.currentPrice,
    });

    return this.currentPrice;
  }

  getPrice(): number {
    return this.currentPrice;
  }

  getNetHoldings(): number {
    return this.netHoldings;
  }

  getPriceHistory(): number[] {
    return [...this.priceHistory];
  }

  getTradeHistory() {
    return [...this.tradeHistory];
  }

  /**
   * Calculate total price change from initial
   */
  getTotalPriceChange(): number {
    return ((this.currentPrice - this.initialPrice) / this.initialPrice) * 100;
  }

  /**
   * Get max drawdown from peak
   */
  getMaxDrawdown(): number {
    let peak = this.priceHistory[0]!;
    let maxDrawdown = 0;

    for (const price of this.priceHistory) {
      if (price > peak) peak = price;
      const drawdown = ((peak - price) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    return maxDrawdown;
  }

  /**
   * Get max gain from bottom
   */
  getMaxGain(): number {
    let bottom = this.priceHistory[0]!;
    let maxGain = 0;

    for (const price of this.priceHistory) {
      if (price < bottom) bottom = price;
      const gain = ((price - bottom) / bottom) * 100;
      if (gain > maxGain) maxGain = gain;
    }

    return maxGain;
  }
}

describe('Market Volatility Simulation', () => {
  describe('Scenario 1: Normal Trading Day', () => {
    it('should show realistic price movements from NPC trades', () => {
      const market = new MarketSimulator(100);

      // Simulate 20 NPC trades over a "day"
      // Mix of buys and sells with varying sizes
      const trades = [
        { action: 'buy' as const, amount: 5000 },
        { action: 'buy' as const, amount: 10000 },
        { action: 'sell' as const, amount: 3000 },
        { action: 'buy' as const, amount: 15000 },
        { action: 'sell' as const, amount: 8000 },
        { action: 'buy' as const, amount: 20000 },
        { action: 'sell' as const, amount: 12000 },
        { action: 'buy' as const, amount: 5000 },
        { action: 'sell' as const, amount: 25000 },
        { action: 'buy' as const, amount: 10000 },
        { action: 'sell' as const, amount: 5000 },
        { action: 'buy' as const, amount: 8000 },
        { action: 'sell' as const, amount: 15000 },
        { action: 'buy' as const, amount: 12000 },
        { action: 'sell' as const, amount: 10000 },
        { action: 'buy' as const, amount: 5000 },
        { action: 'sell' as const, amount: 8000 },
        { action: 'buy' as const, amount: 15000 },
        { action: 'sell' as const, amount: 5000 },
        { action: 'buy' as const, amount: 10000 },
      ];

      trades.forEach((trade, i) => {
        market.trade(trade.action, trade.amount, i);
      });

      const history = market.getTradeHistory();

      // Verify price movements are meaningful but bounded
      expect(market.getPrice()).toBeGreaterThan(0);
      expect(market.getPrice()).toBeGreaterThanOrEqual(100 * 0.05); // Floor
      expect(market.getPrice()).toBeLessThanOrEqual(100 * 10); // Ceiling

      // With bonding curve, trades should have noticeable impact
      const significantMoves = history.filter(
        (t) => Math.abs(t.priceImpact) > 1
      );
      expect(significantMoves.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 2: Panic Sell Cascade', () => {
    it('should allow dramatic crash but respect floor', () => {
      const market = new MarketSimulator(100);

      // Simulate panic: 10 large consecutive sells
      for (let i = 0; i < 10; i++) {
        const sellAmount = 30000 + i * 5000; // Increasing panic
        market.trade('sell', sellAmount, i);
      }

      // Price should crash significantly but not below floor
      expect(market.getPrice()).toBeLessThan(100); // Price dropped
      expect(market.getPrice()).toBeGreaterThanOrEqual(5); // 5% floor
      expect(market.getTotalPriceChange()).toBeLessThan(0); // Negative change
    });
  });

  describe('Scenario 3: FOMO Pump', () => {
    it('should allow dramatic pump but respect ceiling', () => {
      const market = new MarketSimulator(100);

      // Simulate FOMO: 10 large consecutive buys
      for (let i = 0; i < 10; i++) {
        const buyAmount = 40000 + i * 10000; // Increasing FOMO
        market.trade('buy', buyAmount, i);
      }

      // Price should pump significantly but not above ceiling
      expect(market.getPrice()).toBeGreaterThan(100); // Price increased
      expect(market.getPrice()).toBeLessThanOrEqual(1000); // 10x ceiling
      expect(market.getTotalPriceChange()).toBeGreaterThan(0); // Positive change
    });
  });

  describe('Scenario 4: Max Position Size Impact', () => {
    it('should show meaningful impact from max NPC trade ($50k)', () => {
      const market = new MarketSimulator(100);

      // Single max NPC trade
      market.trade('buy', 50000, 0);

      const impact = market.getTotalPriceChange();

      // $50k trade should have significant impact (>5%)
      expect(impact).toBeGreaterThan(5);
      // But not exceed 30% max change per trade
      expect(impact).toBeLessThanOrEqual(30);
    });
  });

  describe('Scenario 6: Momentum-Based Trading', () => {
    it('should show how herd vs contrarian NPCs trade differently', () => {
      // Simulate a market in panic (-15% change)
      const panicMomentum = {
        ticker: 'NVDAI',
        organizationId: 'nvidai',
        priceChange1h: -0.15,
        priceChangePercent: -15,
        currentPrice: 85,
        previousPrice: 100,
        signal: 'panic' as const,
        strength: 0.5,
      };

      // Verify expected behaviors
      const herdSell = MarketMomentumService.getTradingMultiplier(
        panicMomentum,
        'herd',
        'sell'
      );
      const contrarianBuy = MarketMomentumService.getTradingMultiplier(
        panicMomentum,
        'contrarian',
        'buy'
      );

      // Herd should panic sell more
      expect(herdSell.multiplier).toBeGreaterThan(1);
      // Contrarians should buy the dip
      expect(contrarianBuy.multiplier).toBeGreaterThan(1);
    });
  });

  describe('Bonding Curve Math Verification', () => {
    it('should verify quadratic formula produces expected results', () => {
      const testCases = [
        { holdings: 0, expected: 100 },
        { holdings: 50000, expected: 225 }, // (1 + 0.5)^2 = 2.25
        { holdings: 100000, expected: 400 }, // (1 + 1)^2 = 4
        { holdings: -50000, expected: 25 }, // (1 - 0.5)^2 = 0.25
      ];

      testCases.forEach((tc) => {
        const price = calculateBondingCurvePrice(100, tc.holdings, {
          EXPONENT: 2,
          RESERVE_DEPTH: 100000,
          USE_BONDING_CURVE: true,
        });
        expect(price).toBeCloseTo(tc.expected, 0);
      });
    });
  });
});
