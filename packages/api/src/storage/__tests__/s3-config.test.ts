import { afterEach, describe, expect, it } from 'bun:test';
import { resolveS3Config } from '../s3-client';

const KEYS = [
  'NODE_ENV',
  'MINIO_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET',
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('resolveS3Config', () => {
  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('uses docker-compose MinIO defaults outside production', () => {
    setEnv({ NODE_ENV: 'development' });
    expect(resolveS3Config()).toEqual({
      endpoint: 'http://localhost:9000',
      accessKeyId: 'feed',
      secretAccessKey: 'feed_dev_password',
      bucket: 'feed-uploads',
    });
  });

  it('refuses to fall back to local MinIO credentials in production', () => {
    setEnv({ NODE_ENV: 'production', MINIO_ENDPOINT: 'https://s3.example' });
    expect(() => resolveS3Config()).toThrow('MINIO_ACCESS_KEY is required');
  });
});
