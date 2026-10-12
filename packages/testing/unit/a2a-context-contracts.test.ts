import { expect, test } from 'bun:test';
import {
  balanceContextSchema,
  perpetualMarketsContextSchema,
  positionsContextSchema,
  predictionMarketsContextSchema,
  requireContextArray,
  userWalletContextSchema,
} from '../../agents/src/plugins/feed/providers/context-contracts';

test('wallet context rejects absent or nonfinite financial data', () => {
  for (const balance of [
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    expect(() =>
      balanceContextSchema.parse({
        balance,
        reputationPoints: 0,
        lifetimePnL: 0,
      })
    ).toThrow();
  }
  expect(
    balanceContextSchema.parse({
      balance: 0,
      reputationPoints: 0,
      lifetimePnL: -1,
    }).balance
  ).toBe(0);
});

test('empty portfolios are valid; missing portfolios and price sources are not', () => {
  expect(
    positionsContextSchema.parse({ marketPositions: [], perpPositions: [] })
      .perpPositions
  ).toEqual([]);
  expect(() => positionsContextSchema.parse({ marketPositions: [] })).toThrow();
  expect(() => requireContextArray(null, 'feed')).toThrow('explicit array');
  expect(() =>
    positionsContextSchema.parse({
      marketPositions: [],
      perpPositions: [
        {
          id: 'p',
          ticker: 'X',
          side: 'long',
          size: 100,
          entryPrice: 10,
          currentPrice: null,
          leverage: 1,
          unrealizedPnL: 0,
        },
      ],
    })
  ).toThrow();
});

test('remote user wallets require deposit and withdrawal totals instead of inventing zero', () => {
  const wallet = {
    balance: {
      balance: 0,
      reputationPoints: 0,
      lifetimePnL: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
    },
    positions: { marketPositions: [], perpPositions: [] },
  };
  expect(userWalletContextSchema.parse(wallet).balance.totalDeposited).toBe(0);
  expect(() =>
    userWalletContextSchema.parse({
      ...wallet,
      balance: { ...wallet.balance, totalDeposited: null },
    })
  ).toThrow();
  expect(() =>
    userWalletContextSchema.parse({
      ...wallet,
      balance: { ...wallet.balance, totalWithdrawn: undefined },
    })
  ).toThrow();
});

test('market context requires explicit collections and executable market identifiers', () => {
  expect(
    predictionMarketsContextSchema.parse({ predictions: [] }).predictions
  ).toEqual([]);
  expect(() => predictionMarketsContextSchema.parse({ markets: [] })).toThrow();
  const market = {
    ticker: 'XYZ',
    name: 'Example',
    currentPrice: 1,
    priceChange24h: 0,
    volume24h: 0,
    openInterest: 0,
    fundingRate: 0,
  };
  expect(
    perpetualMarketsContextSchema.parse({ perpetuals: [market] }).perpetuals[0]
      ?.ticker
  ).toBe('XYZ');
  for (const invalid of [
    { ticker: undefined },
    { currentPrice: null },
    { currentPrice: 0 },
    { fundingRate: undefined },
  ]) {
    expect(() =>
      perpetualMarketsContextSchema.parse({
        perpetuals: [{ ...market, ...invalid }],
      })
    ).toThrow();
  }
});
