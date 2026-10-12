import { redirect } from 'next/navigation';

export default async function PredictionMarketRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ side?: string | string[] }>;
}) {
  const [{ id }, { side }] = await Promise.all([params, searchParams]);

  const query = new URLSearchParams({
    filter: 'prediction',
    marketKind: 'prediction',
    marketId: id,
  });
  if (side === 'yes' || side === 'no') {
    query.set('side', side);
  }

  redirect(`/markets?${query.toString()}`);
}
