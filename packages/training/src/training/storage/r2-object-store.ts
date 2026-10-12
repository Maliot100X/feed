import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { R2Bucket } from '@cloudflare/workers-types';
import { getCloudflareContext } from '@opennextjs/cloudflare';

declare global {
  interface CloudflareEnv {
    TRAINING_OBJECTS: R2Bucket;
  }
}
interface Artifact {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
}
const prefix = 'r2://training/';
function keyFor(value: string): string {
  const key = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (
    !key ||
    key.includes('://') ||
    key.startsWith('/') ||
    key.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new Error('Invalid training artifact key');
  }
  return key;
}
function bucket(): R2Bucket {
  const binding = getCloudflareContext().env.TRAINING_OBJECTS;
  if (!binding) throw new Error('TRAINING_OBJECTS R2 binding is required');
  return binding;
}
function externalStore() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const Bucket = process.env.R2_TRAINING_BUCKET;
  if (!account || !accessKeyId || !secretAccessKey || !Bucket) {
    throw new Error(
      'External training requires CLOUDFLARE_ACCOUNT_ID, R2_TRAINING_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY'
    );
  }
  return {
    Bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export async function put(
  pathname: string,
  body: Buffer | string
): Promise<Artifact> {
  const key = keyFor(pathname);
  const value =
    typeof body === 'string'
      ? new TextEncoder().encode(body)
      : new Uint8Array(body);
  if (process.env.DEPLOYMENT_PLATFORM === 'cloudflare') {
    const object = await bucket().put(key, value);
    if (!object) throw new Error('Training artifact write failed');
    return {
      url: `${prefix}${key}`,
      pathname: key,
      size: object.size,
      uploadedAt: object.uploaded,
    };
  }
  const { client, Bucket } = externalStore();
  await client.send(new PutObjectCommand({ Bucket, Key: key, Body: value }));
  return {
    url: `${prefix}${key}`,
    pathname: key,
    size: value.length,
    uploadedAt: new Date(),
  };
}

export async function list(options: {
  prefix: string;
}): Promise<{ blobs: Artifact[] }> {
  const blobs: Artifact[] = [];
  let cursor: string | undefined;
  if (process.env.DEPLOYMENT_PLATFORM === 'cloudflare') {
    do {
      const page = await bucket().list({ prefix: options.prefix, cursor });
      blobs.push(
        ...page.objects.map((object) => ({
          url: `${prefix}${object.key}`,
          pathname: object.key,
          size: object.size,
          uploadedAt: object.uploaded,
        }))
      );
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } else {
    const { client, Bucket } = externalStore();
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: options.prefix,
          ContinuationToken: cursor,
        })
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key || !object.LastModified || object.Size === undefined)
          throw new Error('Incomplete R2 object metadata');
        blobs.push({
          url: `${prefix}${object.Key}`,
          pathname: object.Key,
          size: object.Size,
          uploadedAt: object.LastModified,
        });
      }
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (cursor);
  }
  return { blobs };
}

export async function del(url: string) {
  const Key = keyFor(url);
  if (process.env.DEPLOYMENT_PLATFORM === 'cloudflare')
    await bucket().delete(Key);
  else {
    const { client, Bucket } = externalStore();
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
  }
}

/** Training artifacts stay private; only the authenticated server or training job reads them. */
export async function readArtifact(url: string): Promise<Response> {
  const Key = keyFor(url);
  if (process.env.DEPLOYMENT_PLATFORM === 'cloudflare') {
    const object = await bucket().get(Key);
    if (!object) throw new Error('Training artifact not found');
    return new Response(await object.arrayBuffer());
  }
  const { client, Bucket } = externalStore();
  const object = await client.send(new GetObjectCommand({ Bucket, Key }));
  if (!object.Body) throw new Error('Training artifact not found');
  return new Response(new Uint8Array(await object.Body.transformToByteArray()));
}
