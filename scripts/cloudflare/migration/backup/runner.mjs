import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

const env = process.env.MIGRATION_ENVIRONMENT;
if (!['staging', 'production'].includes(env))
  throw Error('Invalid environment');
const source = new URL(process.env.SOURCE_DATABASE_URL.trim());
if (!source.hostname.endsWith('.neon.tech')) throw Error('Unexpected source');
const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    sessionToken: process.env.R2_SESSION_TOKEN,
  },
});
const Key = `neon/${env}/${new Date().toISOString().replaceAll(':', '-')}.dump`;
const Bucket = 'feed-migration-backups';
const init = await client.send(
  new CreateMultipartUploadCommand({
    Bucket,
    Key,
    ContentType: 'application/vnd.postgresql.dump',
  })
);
const pgenv = {
  ...process.env,
  PGHOST: source.hostname,
  PGPORT: source.port || '5432',
  PGUSER: decodeURIComponent(source.username),
  PGPASSWORD: decodeURIComponent(source.password),
  PGDATABASE: source.pathname.slice(1),
  PGSSLMODE: 'verify-full',
  PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt',
  PGCONNECT_TIMEOUT: '30',
  PGAPPNAME: 'feed-migration-backup',
  PGOPTIONS: '-c default_transaction_read_only=on',
};
const pg = spawn(
  'pg_dump',
  [
    '--format=custom',
    '--compress=gzip:6',
    '--no-owner',
    '--no-acl',
    '--lock-wait-timeout=30000',
  ],
  { env: pgenv, stdio: ['ignore', 'pipe', 'pipe'] }
);
let errors = '';
pg.stderr.on('data', (b) => {
  errors += b.toString();
});
const ended = new Promise((resolve) => pg.on('close', (code) => resolve(code)));
const hash = createHash('sha256');
let bytes = 0;
let buffer = Buffer.alloc(0);
const Parts = [];
const size = 16 * 1024 * 1024;
async function upload(body) {
  hash.update(body);
  bytes += body.length;
  const PartNumber = Parts.length + 1;
  const r = await client.send(
    new UploadPartCommand({
      Bucket,
      Key,
      UploadId: init.UploadId,
      PartNumber,
      Body: body,
    })
  );
  Parts.push({ PartNumber, ETag: r.ETag });
  console.log(
    JSON.stringify({ env, uploadedMiB: Math.round(bytes / 1048576) })
  );
}
try {
  console.log(JSON.stringify({ env, backup: Key, started: true }));
  for await (const chunk of pg.stdout) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= size) {
      await upload(buffer.subarray(0, size));
      buffer = buffer.subarray(size);
    }
  }
  const exitCode = await ended;
  if (exitCode !== 0) throw Error(`pg_dump failed (${exitCode}): ${errors}`);
  if (buffer.length) await upload(buffer);
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket,
      Key,
      UploadId: init.UploadId,
      MultipartUpload: { Parts },
    })
  );
  const head = await client.send(new HeadObjectCommand({ Bucket, Key }));
  if (head.ContentLength !== bytes) throw Error('Backup size mismatch');
  const result = {
    env,
    Bucket,
    Key,
    bytes,
    sha256: hash.digest('hex'),
    pgDumpExitCode: exitCode,
    createdAt: new Date().toISOString(),
    restored: false,
  };
  await client.send(
    new PutObjectCommand({
      Bucket,
      Key: Key + '.manifest.json',
      Body: JSON.stringify(result),
      ContentType: 'application/json',
    })
  );
  console.log(JSON.stringify(result));
} catch (error) {
  pg.kill('SIGTERM');
  await client
    .send(
      new AbortMultipartUploadCommand({ Bucket, Key, UploadId: init.UploadId })
    )
    .catch(() => {});
  throw error;
} finally {
  client.destroy();
}
