import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const env = process.env.MIGRATION_ENVIRONMENT;
if (!['staging', 'production'].includes(env))
  throw Error('Invalid environment');
const Key = process.env.BACKUP_KEY;
if (!Key?.startsWith(`neon/${env}/`) || !Key.endsWith('.dump'))
  throw Error('Invalid backup key');
if (!process.env.PGHOST?.endsWith('.railway.internal'))
  throw Error('Restore must target Railway private network');
const Bucket = 'feed-migration-backups';
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    sessionToken: process.env.R2_SESSION_TOKEN,
  },
});
await writeFile('/tmp/target-ca.pem', process.env.TARGET_CA, { mode: 0o600 });
const pgenv = {
  ...process.env,
  PGSSLMODE: 'verify-ca',
  PGSSLROOTCERT: '/tmp/target-ca.pem',
  PGCONNECT_TIMEOUT: '30',
  PGAPPNAME: 'feed-migration-restore',
};
function command(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: pgenv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(Error(`${binary} failed (${code}): ${err.slice(-5000)}`))
    );
  });
}
let manifest;
for (let i = 0; i < 288; i++) {
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket, Key: Key + '.manifest.json' })
    );
    manifest = JSON.parse(await object.Body.transformToString());
    break;
  } catch (error) {
    if (error.name !== 'NoSuchKey') throw error;
    console.log(JSON.stringify({ env, waitingForCompletedBackup: true }));
    await new Promise((r) => setTimeout(r, 300000));
  }
}
if (
  !manifest ||
  manifest.Key !== Key ||
  manifest.Bucket !== Bucket ||
  manifest.pgDumpExitCode !== 0 ||
  !manifest.sha256
)
  throw Error('Missing valid backup manifest');
const count = await command('psql', [
  '-AtX',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')",
]);
if (Number(count.trim()) !== 0)
  throw Error('Target is not empty; refusing restore');
console.log(JSON.stringify({ env, downloading: Key, bytes: manifest.bytes }));
const object = await client.send(new GetObjectCommand({ Bucket, Key }));
const hash = createHash('sha256');
let bytes = 0;
const meter = new Transform({
  transform(chunk, encoding, callback) {
    hash.update(chunk);
    bytes += chunk.length;
    callback(null, chunk);
  },
});
await pipeline(
  object.Body,
  meter,
  createWriteStream('/tmp/backup.dump', { mode: 0o600 })
);
if (bytes !== manifest.bytes || hash.digest('hex') !== manifest.sha256)
  throw Error('Backup readback checksum mismatch');
console.log(
  JSON.stringify({ env, backupReadbackVerified: true, restoring: true })
);
await command('pg_restore', [
  '--exit-on-error',
  '--single-transaction',
  '--no-owner',
  '--no-acl',
  '--dbname',
  process.env.PGDATABASE,
  '/tmp/backup.dump',
]);
const stats = await command('psql', [
  '-AtX',
  '-v',
  'ON_ERROR_STOP=1',
  '-c',
  "SELECT json_build_object('databaseBytes',pg_database_size(current_database()),'tables',(SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')),'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()))",
]);
// Count every restored table, including legacy tables outside the current schema.
const queries = await command('psql', [
  '-AtX',
  '-c',
  "SELECT format('SELECT json_build_object(''schema'', %L, ''table'', %L, ''rows'', count(*)) FROM %I.%I;',schemaname,tablename,schemaname,tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename",
]);
await writeFile('/tmp/counts.sql', queries, { mode: 0o600 });
const counts = await command('psql', [
  '-AtX',
  '-v',
  'ON_ERROR_STOP=1',
  '-f',
  '/tmp/counts.sql',
]);
const result = {
  env,
  backup: manifest,
  restoredAt: new Date().toISOString(),
  backupReadbackVerified: true,
  pgRestoreExitCode: 0,
  stats: JSON.parse(stats),
  rowCounts: counts.trim().split('\n').map(JSON.parse),
};
await client.send(
  new PutObjectCommand({
    Bucket,
    Key: Key + '.restore.json',
    Body: JSON.stringify(result),
    ContentType: 'application/json',
  })
);
console.log(
  JSON.stringify({
    env,
    restored: true,
    ...result.stats,
    receipt: Key + '.restore.json',
  })
);
await unlink('/tmp/backup.dump');
client.destroy();
