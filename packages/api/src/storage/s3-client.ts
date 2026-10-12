import type { Buffer } from 'node:buffer';
/** Local MinIO storage and Cloudflare R2 production storage. */

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { logger } from '@feed/shared';
import { R2StorageClient } from './r2-client';

interface S3StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * S3/MinIO configuration. The docker-compose MinIO defaults are only used
 * outside production; production must configure every value explicitly (or
 * use STORAGE_PROVIDER=r2).
 */
function resolveS3Config(): S3StorageConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const read = (name: string, devDefault: string): string => {
    const value = process.env[name];
    if (value) return value;
    if (isProduction) {
      throw new Error(
        `${name} is required for S3 storage in production (or set STORAGE_PROVIDER=r2)`
      );
    }
    return devDefault;
  };
  return {
    endpoint: read('MINIO_ENDPOINT', 'http://localhost:9000'),
    accessKeyId: read('MINIO_ACCESS_KEY', 'feed'),
    secretAccessKey: read('MINIO_SECRET_KEY', 'feed_dev_password'),
    bucket: read('MINIO_BUCKET', 'feed-uploads'),
  };
}

interface UploadOptions {
  file: Buffer;
  filename: string;
  contentType: string;
  folder?:
    | 'profiles'
    | 'covers'
    | 'posts'
    | 'user-profiles'
    | 'user-banners'
    | 'actors'
    | 'actor-banners'
    | 'organizations'
    | 'org-banners'
    | 'logos'
    | 'icons'
    | 'static';
}

interface UploadResult {
  url: string;
  key: string;
  size: number;
}

class S3StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  constructor(config: S3StorageConfig = resolveS3Config()) {
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
    this.publicUrl = config.endpoint.replace(/\/$/, '');
  }

  /**
   * Upload an image file
   * Images are uploaded as-is; optimization is handled by the web host.
   */
  async uploadImage(options: UploadOptions): Promise<UploadResult> {
    const buffer = options.file;

    // Generate path/key
    const folder = options.folder || 'uploads';
    const pathname = `${folder}/${options.filename}`;

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: pathname,
        Body: buffer,
        ContentType: options.contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      },
    });

    await upload.done();

    const url = `${this.publicUrl}/${this.bucket}/${pathname}`;

    logger.info('Image uploaded successfully to MinIO', {
      key: pathname,
      size: buffer.length,
      bucket: this.bucket,
    });

    return {
      url,
      key: pathname,
      size: buffer.length,
    };
  }

  /**
   * Delete an image file
   */
  async deleteImage(url: string): Promise<void> {
    const key = this.objectKey(url);

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
    logger.info('Image deleted successfully from MinIO', { key });
  }

  /**
   * Object key for a key or a public URL of this store. URLs must point at
   * this endpoint and bucket.
   */
  private objectKey(input: string): string {
    if (!/^https?:\/\//.test(input)) return input;
    const url = new URL(input);
    const base = new URL(`${this.publicUrl}/${this.bucket}/`);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error('Object URL does not belong to this storage bucket');
    }
    const key = decodeURIComponent(url.pathname.slice(base.pathname.length));
    if (!key) throw new Error('Invalid object key');
    return key;
  }

  /**
   * Initialize bucket (for development/MinIO only)
   */
  async initializeBucket(): Promise<void> {
    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    logger.info(`Created bucket: ${this.bucket}`);

    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    };

    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.bucket,
        Policy: JSON.stringify(policy),
      })
    );
    logger.info(`Set public policy for bucket: ${this.bucket}`);
  }

  /**
   * List objects in a folder
   */
  async listObjects(prefix: string): Promise<string[]> {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys;
  }

  /**
   * Check if an object exists
   */
  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand, NotFound } = await import('@aws-sdk/client-s3');
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      );
      return true;
    } catch (error) {
      // Only "not found" means absent; provider failures propagate.
      if (error instanceof NotFound) return false;
      throw error;
    }
  }
}

// Singleton instance
let storageClient: S3StorageClient | R2StorageClient | null = null;

export function getStorageClient(): S3StorageClient | R2StorageClient {
  if (!storageClient) {
    storageClient =
      process.env.STORAGE_PROVIDER === 'r2'
        ? new R2StorageClient()
        : new S3StorageClient();
  }
  return storageClient;
}

export type { UploadOptions, UploadResult };

export { resolveS3Config, S3StorageClient };
