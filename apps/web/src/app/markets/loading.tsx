import { PageContainer } from '@/components/shared/PageContainer';
import { Skeleton } from '@/components/shared/Skeleton';

export default function MarketsLoading() {
  return (
    <PageContainer
      noPadding
      className="mt-14 flex h-[calc(100dvh-56px-var(--bottom-nav-height))] min-h-0 flex-col overflow-hidden md:mt-0 md:h-dvh"
    >
      <div className="flex flex-1 overflow-hidden bg-background/20">
        {/* Desktop skeleton */}
        <div className="hidden min-h-0 flex-1 flex-col md:flex">
          <div className="flex h-11 items-center gap-3 border-white/5 border-b bg-background/40 px-3">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-7 flex-1" />
            <Skeleton className="h-7 w-24" />
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="w-[24%] min-w-[220px] border-white/5 border-r p-3">
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 p-4">
              <Skeleton className="h-full w-full" />
            </div>

            <div className="w-[24%] min-w-[220px] border-white/5 border-l p-4">
              <Skeleton className="h-full w-full" />
            </div>
          </div>
        </div>

        {/* Mobile skeleton */}
        <div className="flex min-h-0 flex-1 flex-col md:hidden">
          <div className="border-white/5 border-b bg-background px-4 py-4">
            <Skeleton className="h-6 w-32" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-10 flex-1" />
              <Skeleton className="h-10 flex-1" />
            </div>
          </div>
          <div className="min-h-0 flex-1 p-4">
            <Skeleton className="h-full w-full" />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
