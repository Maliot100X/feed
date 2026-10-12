/**
 * Agent Detail Page - Redirects to Team Chat
 *
 * All agent management is done through the team chat interface, so this
 * route redirects to `/agents/team?selectAgent=<agentId>`.
 *
 * Kept as a client component on purpose: the Capacitor mobile app reuses
 * this page (`apps/mobile/src/app/agents/[agentId]/client.tsx`) inside a
 * static export, where it is rendered without route props and a server
 * `redirect()` is not available.
 *
 * @page /agents/[agentId]
 */

'use client';

export const dynamic = 'force-dynamic';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AgentDetailPage() {
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const agentId = params.agentId;

  useEffect(() => {
    router.replace(`/agents/team?selectAgent=${encodeURIComponent(agentId)}`);
  }, [agentId, router]);

  return null;
}
