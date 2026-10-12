import { describe, expect, it } from 'bun:test';

// Config is evaluated at module load (and the unit preload may already have
// loaded it), so set the environment and import a fresh module instance.
process.env.ALPHA_FAST_TRACK_TARGET_TIER = '1';
process.env.ALPHA_MAX_EXPECTED_SOCIAL_SCORE = '0';
process.env.ALPHA_MAX_EXPECTED_TRADING_SCORE = 'Infinity';
process.env.ALPHA_INCLUDE_TRADING = 'maybe';
process.env.ALPHA_FAST_TRACK_ENABLED = 'no';

const { ALPHA_GROUP_CONFIG } = await import(
  `../../config/alpha-group-config.ts?env-parsing-test`
);

describe('alpha-group-config environment parsing', () => {
  it('never allows fast-tracking into Tier 1 (Inner Circle)', () => {
    expect(ALPHA_GROUP_CONFIG.fastTrackTargetTier).toBe(2);
  });

  it('rejects zero or non-finite normalization denominators', () => {
    expect(ALPHA_GROUP_CONFIG.maxExpectedSocialScore).toBe(100);
    expect(ALPHA_GROUP_CONFIG.maxExpectedTradingScore).toBe(50);
  });

  it('uses the default for unrecognized booleans and honors explicit ones', () => {
    expect(ALPHA_GROUP_CONFIG.includeTradingActivity).toBe(true);
    expect(ALPHA_GROUP_CONFIG.fastTrackEnabled).toBe(false);
  });
});
