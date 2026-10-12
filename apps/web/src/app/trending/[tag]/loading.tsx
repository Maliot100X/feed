import { PageContainer } from '@/components/shared/PageContainer';
import { FeedSkeleton, Skeleton } from '@/components/shared/Skeleton';

export default function TrendingTagLoading() {
  return (
    <PageContainer noPadding className="flex w-full flex-col">
      <div className="relative flex min-h-dvh flex-1 md:min-h-screen">
        <div className="flex min-w-0 flex-1 flex-col border-border lg:border-r lg:border-l">
          {/* Header */}
          <div className="sticky top-0 z-10 shrink-0 border-border border-b bg-background lg:border-b-0 lg:shadow-sm">
            <div className="flex items-center gap-4 px-4 py-3 lg:px-6 lg:py-4">
              <div className="h-9 w-9 rounded-full bg-muted" />
              <div className="space-y-1">
                <Skeleton className="h-6 w-36 lg:w-40" />
                <Skeleton className="h-3 w-20 lg:h-4 lg:w-24" />
              </div>
            </div>
          </div>

          {/* Posts */}
          <div className="flex-1 bg-background">
            <div className="w-full lg:mx-auto lg:max-w-[700px]">
              <FeedSkeleton count={8} />
            </div>
          </div>
        </div>

        {/* Right: Widget placeholder */}
        <div className="hidden w-96 shrink-0 xl:block" />
      </div>
    </PageContainer>
  );
}
