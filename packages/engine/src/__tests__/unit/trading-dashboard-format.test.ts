import { describe, expect, test } from 'bun:test';
import { mapPersonalityToArchetype } from '../../utils/trading-dashboard-format';

describe('mapPersonalityToArchetype', () => {
  test('cautious risk descriptors map to RISK_MANAGER, not DEGEN_TRADER', () => {
    expect(mapPersonalityToArchetype('Risk-averse pension trustee')).toBe(
      'RISK_MANAGER'
    );
    expect(mapPersonalityToArchetype('veteran risk manager')).toBe(
      'RISK_MANAGER'
    );
    expect(mapPersonalityToArchetype('risk averse and patient')).toBe(
      'RISK_MANAGER'
    );
  });

  test('risk-seeking descriptors still map to DEGEN_TRADER', () => {
    expect(mapPersonalityToArchetype('loves risk')).toBe('DEGEN_TRADER');
    expect(mapPersonalityToArchetype('aggressive speculator')).toBe(
      'DEGEN_TRADER'
    );
  });

  test('other archetypes are unchanged', () => {
    expect(mapPersonalityToArchetype('analytical quant')).toBe('QUANT_TRADER');
    expect(mapPersonalityToArchetype('well connected insider')).toBe('INSIDER');
    expect(mapPersonalityToArchetype('calm')).toBe('SYSTEMATIC_TRADER');
  });
});
