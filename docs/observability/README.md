# Observability

Client and server instrumentation for operating Feed in production.

Related: error tracking and performance traces live in Sentry (see `.env.example`); product analytics in PostHog.

Cloudflare deployment logs are enabled in Wrangler. PostHog remains active when configured. Sentry is disabled during migration until Worker compatibility is verified.
