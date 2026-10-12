import type { R2Bucket } from '@cloudflare/workers-types';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { UploadOptions, UploadResult } from './s3-client';

declare global {
  interface CloudflareEnv {
    UPLOADS: R2Bucket;
  }
}

function publicBase(): URL {
  const value = process.env.R2_PUBLIC_URL;
  if (!value) throw new Error('R2_PUBLIC_URL is required for R2 storage');
  const url = new URL(`${value.replace(/\/$/, '')}/`);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('R2_PUBLIC_URL must use HTTPS');
  }
  return url;
}

export function r2ObjectKey(input: string, base: URL = publicBase()): string {
  let key = input;
  if (/^https?:\/\//.test(input)) {
    const url = new URL(input);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error('Object URL does not belong to this R2 store');
    }
    key = decodeURIComponent(url.pathname.slice(base.pathname.length));
  }
  if (
    !key ||
    key.startsWith('/') ||
    key.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Invalid R2 object key');
  }
  return key;
}

/** Native bindings avoid S3 access keys and keep uploads in the deployed environment. */
export class R2StorageClient {
  async uploadImage(options: UploadOptions): Promise<UploadResult> {
    const key = r2ObjectKey(
      `${options.folder || 'uploads'}/${options.filename}`
    );
    const bucket = getCloudflareContext().env.UPLOADS;
    if (!bucket) throw new Error('UPLOADS R2 binding is missing');
    await bucket.put(key, new Uint8Array(options.file), {
      httpMetadata: {
        contentType: options.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return {
      key,
      url: new URL(encodedKey, publicBase()).href,
      size: options.file.length,
    };
  }

  async deleteImage(url: string): Promise<void> {
    await getCloudflareContext().env.UPLOADS.delete(r2ObjectKey(url));
  }

  async initializeBucket(): Promise<void> {
    // Provisioned by the Cloudflare deployment; never mutate bucket policy at runtime.
    if (!getCloudflareContext().env.UPLOADS)
      throw new Error('UPLOADS R2 binding is missing');
  }

  async listObjects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await getCloudflareContext().env.UPLOADS.list({
        prefix,
        cursor,
      });
      keys.push(...page.objects.map((object) => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }

  async exists(key: string): Promise<boolean> {
    return (
      (await getCloudflareContext().env.UPLOADS.head(r2ObjectKey(key))) !== null
    );
  }
}
