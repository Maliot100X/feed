/**
 * Fee Redistribution Service Tests
 *
 * Tests for the stability fund system that maintains NPC liquidity.
 * Critical: Ensures NPCs don't go bankrupt and markets stay liquid.
 */

import { describe, expect, it } from 'bun:test';
import {
  FeeRedistributionService,
  STABILITY_FUND_CONFIG,
} from '../../services/fee-redistribution-service';

describe('Fee Redistribution Configuration', () => {
  describe('STABILITY_FUND_CONFIG Validation', () => {
    it('should divert 30% of platform fees', () => {
      expect(STABILITY_FUND_CONFIG.PLATFORM_FEE_DIVERSION_RATE).toBe(0.3);
    });

    it('should top up NPCs at 20% threshold', () => {
      expect(STABILITY_FUND_CONFIG.TOP_UP_THRESHOLD_RATIO).toBe(0.2);
    });

    it('should top up to 50% of tier minimum', () => {
      expect(STABILITY_FUND_CONFIG.TOP_UP_TARGET_RATIO).toBe(0.5);
    });

    it('should have reasonable redistribution limits', () => {
      expect(STABILITY_FUND_CONFIG.MAX_REDISTRIBUTION_PER_TICK).toBe(50000);
      expect(STABILITY_FUND_CONFIG.MAX_NPCS_PER_TICK).toBe(10);
    });

    it('should maintain minimum reserve', () => {
      expect(STABILITY_FUND_CONFIG.MIN_FUND_RESERVE).toBe(10000);
    });
  });

  describe('calculateDiversionAmount', () => {
    it('should calculate 30% of platform fee', () => {
      // If platform gets $100, stability fund gets $30
      const diversion = FeeRedistributionService.calculateDiversionAmount(100);
      expect(diversion).toBe(30);
    });

    it('should handle small amounts', () => {
      const diversion = FeeRedistributionService.calculateDiversionAmount(1);
      expect(diversion).toBe(0.3);
    });

    it('should handle zero', () => {
      const diversion = FeeRedistributionService.calculateDiversionAmount(0);
      expect(diversion).toBe(0);
    });

    it('should calculate realistic trading fee scenario', () => {
      // $10,000 trade at 0.1% fee = $10 total fee
      // Platform share (50%) = $5
      // Stability fund (30% of platform) = $1.50
      const tradingFee = 10000 * 0.001; // $10
      const platformShare = tradingFee * 0.5; // $5
      const diversion =
        FeeRedistributionService.calculateDiversionAmount(platformShare);
      expect(diversion).toBe(1.5);
    });
  });
});

describe('Edge Cases', () => {
  it('should handle very small fee amounts', () => {
    const diversion = FeeRedistributionService.calculateDiversionAmount(0.01);
    expect(diversion).toBe(0.003);
  });

  it('should handle very large fee amounts', () => {
    const diversion =
      FeeRedistributionService.calculateDiversionAmount(1_000_000);
    expect(diversion).toBe(300_000);
  });
});
