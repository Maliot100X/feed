import { describe, expect, it } from 'bun:test';

// Config is evaluated at module load (and the unit preload may already have
// loaded it), so set the environment and import a fresh module instance.
process.env.NPC_MAX_TRADES_PER_DAY = 'Infinity';
process.env.NPC_TICK_BATCH_SIZE = '2.5';
process.env.NPC_MAX_POSTS_PER_DAY = ' 7 ';

const { NPC_POSTING_CONFIG, NPC_TICK_CONFIG, NPC_TRADING_CONFIG } =
  await import(`../../config/npc-activity.ts?env-parsing-test`);

describe('npc-activity environment parsing', () => {
  it('falls back to the default for non-finite values', () => {
    expect(NPC_TRADING_CONFIG.maxTradesPerDay).toBe(20);
  });

  it('rejects fractional counts', () => {
    expect(NPC_TICK_CONFIG.batchSize).toBe(12);
  });

  it('accepts valid values surrounded by whitespace', () => {
    expect(NPC_POSTING_CONFIG.maxPostsPerDay).toBe(7);
  });
});
