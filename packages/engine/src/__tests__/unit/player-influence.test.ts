import { describe, expect, test } from 'bun:test';
import { handlePlayerTrade } from '../../services/player-influence-service';

describe('handlePlayerTrade', () => {
  test('rejects non-finite or negative sizes instead of treating NaN as significant', async () => {
    for (const size of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      await expect(
        handlePlayerTrade('player', 'TSLAI', 'long', size)
      ).rejects.toThrow(RangeError);
    }
  });

  test('ignores insignificant trades without side effects', async () => {
    await expect(
      handlePlayerTrade('player', 'TSLAI', 'long', 10)
    ).resolves.toBeUndefined();
  });
});
