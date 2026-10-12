import { PageContainer } from '@/components/shared/PageContainer';
import { PostCardSkeleton, Skeleton } from '@/components/shared/Skeleton';

export default function PostDetailLoading() {
  return (
    <PageContainer
      noPadding
      className="flex min-h-dvh flex-col md:min-h-screen"
    >
      <div className="flex flex-1">
        {/* Main Content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-border lg:border-r lg:border-l">
          <div className="w-full lg:mx-auto lg:max-w-[700px]">
            {/* Post Detail */}
            <PostCardSkeleton />

            {/* Comments Section */}
            <div className="space-y-4 p-4 sm:p-6">
              <Skeleton className="mb-4 h-5 w-24 max-w-full lg:h-6 lg:w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex gap-3 border-border/5 border-b pb-4"
                >
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Skeleton className="h-4 w-24 max-w-full" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Widget placeholder (desktop only) */}
        <div className="hidden w-96 shrink-0 border-border/5 border-l bg-background xl:block" />
      </div>
    </PageContainer>
  );
}
