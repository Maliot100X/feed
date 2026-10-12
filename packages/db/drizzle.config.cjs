const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Local mode must be declared explicitly. Absence of DIRECT_DATABASE_URL does
// not imply a local database (production may set only DATABASE_URL).
const isLocalDev =
  process.env.DEPLOYMENT_ENV === 'localnet' ||
  process.env.NODE_ENV === 'development';

const LOCAL_DATABASE_URL =
  'postgresql://feed:feed_dev_password@localhost:5433/feed';

// Prefer the direct (non-pooled) URL for migrations. Only explicit local mode
// may fall back to the docker-compose database.
const databaseUrl =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (isLocalDev ? LOCAL_DATABASE_URL : undefined);

if (!databaseUrl) {
  throw new Error(
    'Missing DIRECT_DATABASE_URL or DATABASE_URL. Set DEPLOYMENT_ENV=localnet ' +
      'to use the local docker-compose database. Refusing to guess a target ' +
      'database to prevent accidental migrations against the wrong one.'
  );
}

// Drizzle Kit resolves `schema`/`out` relative to the current working
// directory and mis-resolves absolute paths (it prefixes them with `./`), so
// compute cwd-relative paths. This makes the config work both from the repo
// root (`--config=packages/db/drizzle.config.cjs`) and from `packages/db`.
const fromCwd = (target) =>
  path.relative(process.cwd(), path.join(__dirname, target)) || '.';

/** @type {import('drizzle-kit').Config} */
module.exports = {
  // eliza.ts is listed separately rather than re-exported through
  // src/schema/index.ts so @elizaos/plugin-sql is not traced into every
  // bundle that imports @feed/db.
  schema: [fromCwd('src/schema/index.ts'), fromCwd('src/schema/eliza.ts')],
  out: fromCwd('drizzle/migrations'),
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
};
