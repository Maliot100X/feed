'use client';

export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AchievementsTab } from '@/components/rewards/v2/achievements-tab';
import { PageContainer } from '@/components/shared/PageContainer';
import { useAuth } from '@/hooks/useAuth';
import { useLoginModal } from '@/hooks/useLoginModal';

export default function AchievementsPage() {
  const router = useRouter();
  const { ready, authenticated } = useAuth();
  const { queueLoginModal } = useLoginModal();

  useEffect(() => {
    if (!ready || authenticated) return;
    // Queue the login modal before leaving: a timer started here would be
    // cancelled by this page's unmount and the modal would never open.
    queueLoginModal();
    router.replace('/feed');
  }, [ready, authenticated, router, queueLoginModal]);

  return (
    <PageContainer
      noPadding
      className="overflow-x-clip! flex flex-col pt-14 md:pt-0"
    >
      <div className="min-h-full w-full border-border lg:border-r lg:border-l">
        <div className="sticky top-14 z-10 border-border border-b bg-background/95 px-4 py-3 backdrop-blur-sm md:top-0">
          <h1 className="font-semibold text-foreground text-lg">
            Achievements
          </h1>
        </div>
        <div className="p-4 pb-[calc(1rem+var(--bottom-nav-height))] md:pb-4">
          <AchievementsTab />
        </div>
      </div>
    </PageContainer>
  );
}
