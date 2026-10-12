import { describe, expect, it } from 'bun:test';
import PerpsMarketRedirectPage from '../perps/[ticker]/page';
import PredictionMarketRedirectPage from '../predictions/[id]/page';

async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  const error = await run().then(
    () => {
      throw new Error('expected redirect');
    },
    (err: Error & { digest?: string }) => err
  );
  const digest = error.digest ?? '';
  expect(digest.startsWith('NEXT_REDIRECT')).toBe(true);
  return digest.split(';')[2] ?? '';
}

describe('market detail redirects', () => {
  it('redirects prediction detail to the markets terminal with valid side', async () => {
    const target = await redirectTarget(() =>
      PredictionMarketRedirectPage({
        params: Promise.resolve({ id: 'm1' }),
        searchParams: Promise.resolve({ side: 'yes' }),
      })
    );
    expect(target).toBe(
      '/markets?filter=prediction&marketKind=prediction&marketId=m1&side=yes'
    );
  });

  it('drops invalid prediction side', async () => {
    const target = await redirectTarget(() =>
      PredictionMarketRedirectPage({
        params: Promise.resolve({ id: 'm1' }),
        searchParams: Promise.resolve({ side: 'long' }),
      })
    );
    expect(target).toBe(
      '/markets?filter=prediction&marketKind=prediction&marketId=m1'
    );
  });

  it('redirects perp detail with valid side only', async () => {
    const target = await redirectTarget(() =>
      PerpsMarketRedirectPage({
        params: Promise.resolve({ ticker: 'BTC' }),
        searchParams: Promise.resolve({ side: ['short', 'long'] }),
      })
    );
    expect(target).toBe('/markets?filter=perp&marketKind=perp&marketId=BTC');
  });
});
