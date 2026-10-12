'use client';

import { ArrowLeft, TrendingUp } from 'lucide-react';
import nextDynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageContainer } from '@/components/shared/PageContainer';

const WidgetSidebar = nextDynamic(
  () =>
    import('@/components/shared/WidgetSidebar').then((m) => ({
      default: m.WidgetSidebar,
    })),
  {
    ssr: false,
    loading: () => <div className="hidden w-96 flex-none xl:block" />,
  }
);

/**
 * Shared responsive layout for trending topic pages: one header and one feed
 * subtree for all breakpoints (feed content is mounted exactly once).
 */
export function TrendingFeedShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string | null;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <PageContainer noPadding className="flex w-full flex-col">
      <div className="relative flex min-h-dvh flex-1 md:min-h-screen">
        <div className="flex min-w-0 flex-1 flex-col border-border lg:border-r lg:border-l">
          <div className="sticky top-0 z-10 shrink-0 border-border border-b bg-background lg:border-b-0 lg:shadow-sm">
            <div className="flex items-center gap-4 px-4 py-3 lg:px-6 lg:py-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Go back"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="flex min-w-0 items-center gap-2">
                <TrendingUp className="h-5 w-5 shrink-0 text-primary" />
                <h1 className="truncate font-bold text-xl">{title}</h1>
              </div>
              {subtitle && (
                <p className="ml-auto shrink-0 text-muted-foreground text-sm">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex-1 bg-background">
            <div className="w-full lg:mx-auto lg:max-w-[700px]">
              {children}
              {/* Spacer for login bar */}
              <div className="pb-24" />
            </div>
          </div>
        </div>

        {/* Widget sidebar - desktop only */}
        <WidgetSidebar />
      </div>
    </PageContainer>
  );
}
