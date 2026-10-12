import { WEB_ORIGIN } from '@/mobile/lib/web-origin';

export default function MobileApiDocsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-12">
      <h1 className="font-semibold text-2xl">API Docs</h1>
      <p className="text-muted-foreground">
        Interactive API documentation is only available in the web app.
      </p>
      <div>
        {/* /api-docs in this static export is this page; link to the web app. */}
        <a
          href={`${WEB_ORIGIN}/api-docs`}
          className="inline-flex rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
        >
          Open Web Docs
        </a>
      </div>
    </main>
  );
}
