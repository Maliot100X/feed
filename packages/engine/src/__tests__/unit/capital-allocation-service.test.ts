import { describe, expect, test } from 'bun:test';
import { CapitalAllocationService } from '../../services/capital-allocation-service';

describe('CapitalAllocationService.getDomainMultiplier', () => {
  test('applies below-1 multipliers for media/entertainment-only actors', () => {
    expect(CapitalAllocationService.getDomainMultiplier(['media'])).toBe(0.8);
    expect(
      CapitalAllocationService.getDomainMultiplier(['entertainment'])
    ).toBe(0.7);
  });

  test('takes the highest recognized domain', () => {
    expect(
      CapitalAllocationService.getDomainMultiplier(['media', 'finance'])
    ).toBe(1.5);
  });

  test('unknown or empty domains are neutral', () => {
    expect(CapitalAllocationService.getDomainMultiplier([])).toBe(1);
    expect(CapitalAllocationService.getDomainMultiplier(['gardening'])).toBe(1);
  });
});

describe('CapitalAllocationService.calculateCapital', () => {
  test('media actor gets reduced capital and readable reasoning', () => {
    const result = CapitalAllocationService.calculateCapital({
      id: 'a',
      name: 'A',
      tier: 'B_TIER',
      domain: ['media'],
    });
    expect(result.tradingBalance).toBe(20000);
    expect(result.reasoning).toContain('0.8x domain');
    expect(result.reasoning).not.toContain('aix');
  });

  test('rejects unknown tiers instead of silently using C-tier', () => {
    expect(() =>
      CapitalAllocationService.calculateCapital({
        id: 'a',
        name: 'A',
        tier: 'Z_TIER',
        domain: [],
      })
    ).toThrow('Invalid tier');
  });
});
