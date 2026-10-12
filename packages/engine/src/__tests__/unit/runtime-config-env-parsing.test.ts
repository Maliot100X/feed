import { describe, expect, it } from 'bun:test';

// Config is evaluated at module load (and the unit preload may already have
// loaded it), so set the environment and import a fresh module instance.
process.env.GAME_TICK_BUDGET_MS = '30000'; // below the 60s reserve
process.env.MARKET_DECISION_MAX_OUTPUT_TOKENS = 'Infinity';
process.env.WORLD_FACTS_UPDATE_INTERVAL_HOURS = '-2';
process.env.WORLD_FACTS_LOCK_DURATION_MINUTES = ' 45 ';
process.env.STRICT_LLM_VALIDATION = '1';

const { GAME_TICK_CONFIG, MARKET_DECISION_CONFIG, WORLD_FACTS_CONFIG } =
  await import(`../../config/runtime-config.ts?env-parsing-test`);

describe('runtime-config environment parsing', () => {
  it('rejects a tick budget that does not exceed the critical-ops reserve', () => {
    expect(GAME_TICK_CONFIG.budgetMs).toBe(180000);
    expect(GAME_TICK_CONFIG.getContentDeadline(0)).toBeGreaterThan(0);
  });

  it('falls back to defaults for non-finite or negative values', () => {
    expect(MARKET_DECISION_CONFIG.maxOutputTokens).toBe(32000);
    expect(WORLD_FACTS_CONFIG.updateIntervalHours).toBe(8);
  });

  it('accepts valid values with surrounding whitespace', () => {
    expect(WORLD_FACTS_CONFIG.lockDurationMinutes).toBe(45);
  });

  it('treats "1" as enabling strict validation', () => {
    expect(MARKET_DECISION_CONFIG.strictValidation).toBe(true);
  });
});
