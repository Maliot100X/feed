import type { Metadata } from 'next';
import { parseTickerParams } from './params';
import { TickerClient } from './TickerClient';

export const metadata: Metadata = {
  title: 'Feed Ticker',
  description:
    'Live ticker: news, prediction markets, and perps. Embed on your site or livestream.',
  robots: 'noindex, nofollow',
};

/**
 * Ticker embed page – minimal layout (no nav/sidebar), iframe-friendly.
 * Query params: streams, theme, speed, height (see TickerClient).
 */
export default async function TickerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseTickerParams(await searchParams);
  return (
    <div className="w-full">
      <TickerClient {...params} />
    </div>
  );
}
