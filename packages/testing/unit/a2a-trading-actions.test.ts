import { expect, test } from 'bun:test';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';
import {
  buySharesAction,
  closePerpPositionAction,
  openPerpPositionAction,
  sellSharesAction,
} from '../../agents/src/plugins/feed/actions/trading';

const message = {
  content: { text: 'Open a 5x long position on XYZ with $1000' },
} as Memory;
function state(actionParams: object): State {
  return { values: {}, text: '', data: { actionParams } } as State;
}
function runtime(client: object): IAgentRuntime {
  return {
    a2aClient: { isConnected: () => true, ...client },
  } as unknown as IAgentRuntime;
}

test('perp action uses structured amount and exact side instead of parsing leverage as amount', async () => {
  const calls: unknown[][] = [];
  const result = {
    success: true,
    position: {
      positionId: 'owned-position',
      ticker: 'XYZ',
      side: 'SHORT',
      entryPrice: 10,
      size: 1000,
      leverage: 5,
    },
    marginPaid: 200,
    newBalance: 800,
  };
  const rt = runtime({
    openPosition: async (...args: unknown[]) => {
      calls.push(args);
      return result;
    },
  });
  const outcome = await openPerpPositionAction.handler(
    rt,
    message,
    state({ ticker: 'XYZ', side: 'SHORT', amount: 1000, leverage: 5 })
  );
  expect(calls).toEqual([['XYZ', 'SHORT', 1000, 5]]);
  expect(outcome).toMatchObject({ success: true, data: result });
  expect(outcome?.text).toContain('owned-position');
});

test('missing required side, amount, shares and position IDs never produce a trade', async () => {
  let calls = 0;
  const rt = runtime({
    openPosition: async () => {
      calls++;
    },
    buyShares: async () => {
      calls++;
    },
    sellShares: async () => {
      calls++;
    },
    closePosition: async () => {
      calls++;
    },
  });
  await expect(
    buySharesAction.handler(
      rt,
      message,
      state({ marketId: 'market', amount: 10 })
    )
  ).rejects.toThrow();
  await expect(
    openPerpPositionAction.handler(
      rt,
      message,
      state({ ticker: 'XYZ', amount: 1000, leverage: 5 })
    )
  ).rejects.toThrow();
  await expect(
    sellSharesAction.handler(
      rt,
      message,
      state({ positionId: 'position', shares: Number.NaN })
    )
  ).rejects.toThrow();
  await expect(
    closePerpPositionAction.handler(rt, message, state({ ticker: 'XYZ' }))
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test('incomplete or failed backend results cannot emit successful callbacks', async () => {
  let callbacks = 0;
  const callback = async () => {
    callbacks++;
    return [];
  };
  const incomplete = runtime({
    closePosition: async () => ({
      success: true,
      position: { positionId: 'position' },
    }),
  });
  await expect(
    closePerpPositionAction.handler(
      incomplete,
      message,
      state({ positionId: 'position' }),
      undefined,
      callback
    )
  ).rejects.toThrow();
  const failed = runtime({
    buyShares: async () => ({
      success: false,
      message: 'Insufficient balance',
    }),
  });
  await expect(
    buySharesAction.handler(
      failed,
      message,
      state({ marketId: 'market', outcome: 'NO', amount: 10 }),
      undefined,
      callback
    )
  ).rejects.toThrow('Insufficient balance');
  expect(callbacks).toBe(0);
});
