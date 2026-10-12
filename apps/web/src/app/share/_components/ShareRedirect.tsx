'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Landing shell for share links.
 *
 * Share pages must render (not server-redirect) so link-preview crawlers
 * receive the page's OG metadata; a server `redirect()` answers with a 307
 * and crawlers would read the destination's metadata instead. Browsers are
 * sent on to `href` client-side.
 */
export function ShareRedirect({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [router, href]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-8">
      <Link href={href} className="text-primary text-sm underline">
        {label}
      </Link>
    </div>
  );
}
