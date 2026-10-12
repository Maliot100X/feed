import { redirect } from 'next/navigation';

export default async function PerpsMarketRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ side?: string | string[] }>;
}) {
  const [{ ticker }, { side }] = await Promise.all([params, searchParams]);

  const query = new URLSearchParams({
    filter: 'perp',
    marketKind: 'perp',
    marketId: ticker,
  });
  if (side === 'long' || side === 'short') {
    query.set('side', side);
  }

  redirect(`/markets?${query.toString()}`);
}
