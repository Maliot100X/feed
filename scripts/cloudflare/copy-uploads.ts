#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { z } from 'zod';

const [environment, inventoryPath, manifestPath, mode] = process.argv.slice(2);
if (
  (environment !== 'staging' && environment !== 'production') ||
  !inventoryPath ||
  !manifestPath ||
  (mode !== '--copy' && mode !== '--audit')
)
  throw new Error(
    'Usage: copy-uploads.ts staging|production inventory.json manifest.jsonl --audit|--copy'
  );
const blobs = z
  .array(
    z.object({
      url: z.string().url(),
      pathname: z.string().min(1),
      size: z.number().int().nonnegative().max(300_000_000),
    })
  )
  .parse(JSON.parse(await readFile(inventoryPath, 'utf8')));
const sourceHost = process.env.LEGACY_BLOB_HOST;
if (!sourceHost || !sourceHost.endsWith('.public.blob.vercel-storage.com'))
  throw new Error('LEGACY_BLOB_HOST must identify the audited public store');
const keys = new Set<string>();
for (const blob of blobs) {
  const url = new URL(blob.url);
  if (
    url.protocol !== 'https:' ||
    url.host !== sourceHost ||
    url.username ||
    url.password
  )
    throw new Error('Inventory contains a different source store');
  if (
    blob.pathname.split('/').some((p) => p === '..' || p === '.' || !p) ||
    keys.has(blob.pathname)
  )
    throw new Error('Inventory contains an invalid or duplicate object key');
  keys.add(blob.pathname);
}
console.info(
  JSON.stringify({
    environment,
    objects: blobs.length,
    bytes: blobs.reduce((sum, b) => sum + b.size, 0),
    mode,
  })
);
if (mode === '--audit') process.exit(0);
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account || !/^[a-f0-9]{32}$/.test(account))
  throw new Error('Cloudflare account/token required');
const origin =
  environment === 'production'
    ? 'https://feed.fun'
    : 'https://staging.feed.fun';
const bucket = `feed-uploads-${environment}`;
let nextRequest = 0;
async function providerFetch(url: string, init?: RequestInit) {
  // Stay below the control-plane API rate limit, including verification reads.
  const scheduled = Math.max(Date.now(), nextRequest);
  nextRequest = scheduled + 350;
  await Bun.sleep(Math.max(0, scheduled - Date.now()));
  return fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
}
function checksum(bytes: ArrayBuffer) {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}
let completed = 0;
async function copyBlob(blob: (typeof blobs)[number]) {
  const source = await fetch(blob.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (!source.ok)
    throw new Error(
      `Source download failed at object ${completed}: HTTP ${source.status}`
    );
  const bytes = await source.arrayBuffer();
  if (bytes.byteLength !== blob.size)
    throw new Error(
      `Source size changed at object ${completed}; refresh inventory`
    );
  const sha256 = checksum(bytes);
  const key = encodeURIComponent(blob.pathname);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${key}`;
  const existing = await providerFetch(endpoint);
  if (existing.status === 404) {
    await existing.arrayBuffer();
    const upload = await providerFetch(endpoint, {
      method: 'PUT',
      body: bytes,
      headers: {
        'Content-Type':
          source.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control':
          source.headers.get('Cache-Control') || 'public, max-age=3600',
      },
    });
    if (!upload.ok)
      throw new Error(
        `R2 upload failed at object ${completed}: HTTP ${upload.status}`
      );
    await upload.arrayBuffer();
    const verify = await providerFetch(endpoint);
    if (!verify.ok || checksum(await verify.arrayBuffer()) !== sha256)
      throw new Error(`R2 verification failed at object ${completed}`);
  } else {
    if (!existing.ok || checksum(await existing.arrayBuffer()) !== sha256)
      throw new Error(
        `Existing R2 object differs at object ${completed}; refusing overwrite`
      );
  }
  await appendFile(
    manifestPath,
    JSON.stringify({
      bucket,
      oldUrl: blob.url,
      newUrl: `${origin}/media/${blob.pathname.split('/').map(encodeURIComponent).join('/')}`,
      key: blob.pathname,
      bytes: blob.size,
      sha256,
      verifiedAt: new Date().toISOString(),
    }) + '\n',
    { mode: 0o600 }
  );
  completed++;
  if (completed % 50 === 0)
    console.info(`Verified ${completed}/${blobs.length}`);
}
for (let offset = 0; offset < blobs.length; offset += 8) {
  const results = await Promise.allSettled(
    blobs.slice(offset, offset + 8).map(copyBlob)
  );
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
}
console.info(
  `Verified all ${completed} objects. Database references were not changed.`
);
