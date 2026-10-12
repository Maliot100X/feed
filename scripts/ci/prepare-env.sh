#!/usr/bin/env bash

set -euo pipefail

# Use DATABASE_URL from environment, fallback to default for local testing
DB_URL=${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/test_db}

create_env_files() {
if [[ -f .env.test ]]; then
  echo "ℹ️  Using existing .env.test"
else
  echo "📝 Creating .env.test from environment variables"
  cat > .env.test <<EOF
# Database
DATABASE_URL=${DB_URL}
DIRECT_DATABASE_URL=${DIRECT_DATABASE_URL:-$DB_URL}

# Auth (local CI fixture; never use the production signing key here)
NEXT_PUBLIC_STEWARD_API_URL=${NEXT_PUBLIC_STEWARD_API_URL:-https://steward.invalid}
STEWARD_JWT_SECRET=${STEWARD_JWT_SECRET:-ci-only-steward-signing-fixture}
# Make PRIVY_APP_ID and NEXT_PUBLIC_PRIVY_APP_ID interchangeable
PRIVY_APP_ID=${PRIVY_APP_ID:-${NEXT_PUBLIC_PRIVY_APP_ID:-}}
NEXT_PUBLIC_PRIVY_APP_ID=${NEXT_PUBLIC_PRIVY_APP_ID:-${PRIVY_APP_ID:-}}
PRIVY_APP_SECRET=${PRIVY_APP_SECRET:-}
PRIVY_TEST_EMAIL=${PRIVY_TEST_EMAIL:-}
PRIVY_TEST_PHONE=${PRIVY_TEST_PHONE:-}
PRIVY_TEST_OTP=${PRIVY_TEST_OTP:-}
PRIVY_TEST_PASSWORD=${PRIVY_TEST_PASSWORD:-}

# API Keys
SURPLUS_API_KEY=${SURPLUS_API_KEY:-}
SURPLUS_BASE_URL=${SURPLUS_BASE_URL:-https://api.surplusintelligence.ai/v1}
SURPLUS_MODEL=${SURPLUS_MODEL:-gpt-4o-mini}
SURPLUS_EMBEDDING_MODEL=${SURPLUS_EMBEDDING_MODEL:-venice-embed-1}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
GROQ_API_KEY=${GROQ_API_KEY:-}
FAL_KEY=${FAL_KEY:-}

# Chain (default to Base Sepolia for CI builds/tests)
NEXT_PUBLIC_CHAIN_ID=${NEXT_PUBLIC_CHAIN_ID:-84532}
NEXT_PUBLIC_RPC_URL=${NEXT_PUBLIC_RPC_URL:-}

# Other
CRON_SECRET=${CRON_SECRET:-test-cron-secret}
WALLET_SEED_PHRASE=${WALLET_SEED_PHRASE:-}
WALLET_PASSWORD=${WALLET_PASSWORD:-}

# Redis (if applicable)
${REDIS_URL:+REDIS_URL=${REDIS_URL}}
EOF
fi

  cp .env.test .env
  cp .env.test .env.local
  chmod 600 .env.test .env .env.local
}

main() {
  create_env_files
  echo "✅ Environment files created: .env.test, .env, .env.local"
  echo "Database and auth configuration written; values are not printed."
  if [[ -n "${SURPLUS_API_KEY:-}" ]]; then
    echo "Surplus inference credential is configured."
  fi
  # Privy credentials are retained only for legacy optional browser tests.
}

main "$@"
