/**
 * /agents is a compatibility route: agent management lives on /agents/team,
 * which enforces authentication itself. Query parameters are forwarded.
 *
 * Kept as a client component on purpose: the Capacitor mobile app re-exports
 * this page (`apps/mobile/src/app/agents/page.tsx`) inside a static export,
 * where a server `redirect()` and request `searchParams` are not available.
 *
 * @page /agents
 */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function AgentsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  useEffect(() => {
    router.replace(`/agents/team${qs ? `?${qs}` : ''}`);
  }, [qs, router]);

  return null;
}

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsRedirect />
    </Suspense>
  );
}
