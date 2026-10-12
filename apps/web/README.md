# Feed Web (`apps/web`)

Next.js application: UI, API routes, SSE, and Steward auth wiring, deployed through OpenNext to Cloudflare Workers.

## Deployment and observability

See the root [deployment runbook](../../README.md#deployment) for environment secrets,
R2 migration, scheduled jobs, and cutover gates. Worker logs and PostHog replace the
removed Vercel Analytics/Speed Insights integration. Sentry remains disabled until
validated on Workers.

## Related docs

| Topic | Location |
|-------|----------|
| Observability index | [`docs/observability/README.md`](../../docs/observability/README.md) |
| Markets / terminal (example feature README) | [`src/app/markets/README.md`](./src/app/markets/README.md) |

## Commands

From repo root:

```bash
bun run dev:web    # This app only
bun run build:cloudflare staging # OpenNext Worker build
```

See root [`README.md`](../../README.md) for full quality gates and monorepo commands.
