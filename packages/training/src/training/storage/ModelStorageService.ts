/**
 * Model Storage Service (Cloudflare R2)
 *
 * Handles model versioning and storage using Cloudflare R2.
 * Stores trained models with metadata for easy deployment.
 */

import { db, eq, trainedModels } from '@feed/db';
import type { JsonValue } from '@feed/shared';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../utils/logger';
import { del, list, put, readArtifact } from './r2-object-store';

export interface ModelMetadata {
  trainingBatch?: string;
  accuracy?: number;
  avgReward?: number;
  baseModel?: string;
}

export interface ModelVersion {
  version: string;
  baseModel: string;
  blobUrl: string;
  size: number;
  uploadedAt: Date;
  metadata: ModelMetadata & Record<string, JsonValue | undefined>;
}

export class ModelStorageService {
  private readonly blobPrefix = 'models/';

  /**
   * Upload trained model to Cloudflare R2
   */
  async uploadModel(options: {
    version: string;
    modelPath: string;
    metadata?: ModelVersion['metadata'];
  }): Promise<ModelVersion> {
    logger.info('Uploading model to Cloudflare R2', {
      version: options.version,
      path: options.modelPath,
    });

    // Read model file
    const modelData = await fs.readFile(options.modelPath);
    const fileName = path.basename(options.modelPath);

    // Upload to Cloudflare R2
    const blob = await put(
      `${this.blobPrefix}${options.version}/${fileName}`,
      modelData
    );

    // Upload metadata
    await put(
      `${this.blobPrefix}${options.version}/metadata.json`,
      JSON.stringify(options.metadata || {}, null, 2)
    );

    logger.info('Model uploaded to Cloudflare R2', {
      version: options.version,
      url: blob.url,
      size: (blob as { size?: number }).size || 0,
    });

    // Save to database using native Drizzle
    await db.insert(trainedModels).values({
      id: `model-${Date.now()}`,
      modelId: `feed-agent-${options.version}`,
      version: options.version,
      baseModel:
        (options.metadata?.baseModel as string) || 'unsloth/Qwen3-4B-128K',
      storagePath: blob.url,
      accuracy: (options.metadata?.accuracy as number) || null,
      avgReward: (options.metadata?.avgReward as number) || null,
      status: 'ready',
      agentsUsing: 0,
      updatedAt: new Date(),
    });

    return {
      version: options.version,
      baseModel:
        (options.metadata?.baseModel as string) || 'unsloth/Qwen3-4B-128K',
      blobUrl: blob.url,
      size: (blob as { size?: number }).size || 0,
      uploadedAt: new Date(),
      metadata: options.metadata || {},
    };
  }

  /**
   * Download model from Cloudflare R2
   */
  async downloadModel(version: string): Promise<{
    modelData: Buffer;
    metadata: ModelVersion['metadata'];
  }> {
    const modelResult = await db
      .select({ storagePath: trainedModels.storagePath })
      .from(trainedModels)
      .where(eq(trainedModels.version, version))
      .limit(1);

    const model = modelResult[0];

    if (!model) {
      throw new Error(`Model version ${version} not found`);
    }

    // Download model file
    const modelResponse = await readArtifact(model.storagePath);
    const modelData = Buffer.from(await modelResponse.arrayBuffer());

    // Download metadata
    const metadataUrl = model.storagePath.replace(/\/[^/]+$/, '/metadata.json');
    const metadataResponse = await readArtifact(metadataUrl);
    const metadata =
      (await metadataResponse.json()) as ModelVersion['metadata'];

    return {
      modelData,
      metadata,
    };
  }

  /**
   * List all model versions
   */
  async listModels(): Promise<ModelVersion[]> {
    const { blobs } = await list({
      prefix: this.blobPrefix,
    });

    // Group by version
    interface BlobInfo {
      url: string;
      pathname: string;
      size: number;
      uploadedAt: string | Date;
    }

    interface VersionData {
      version: string;
      blobs: BlobInfo[];
    }

    const versions = new Map<string, VersionData>();

    for (const blob of blobs) {
      const parts = blob.pathname.split('/');
      const version = parts[1];
      if (!version) continue;

      if (!versions.has(version)) {
        versions.set(version, {
          version,
          blobs: [],
        });
      }
      // Convert uploadedAt to string if it's a Date
      const blobInfo: BlobInfo = {
        ...blob,
        uploadedAt:
          blob.uploadedAt instanceof Date
            ? blob.uploadedAt.toISOString()
            : blob.uploadedAt,
      };
      versions.get(version)!.blobs.push(blobInfo);
    }

    // Get metadata for each version
    const models: ModelVersion[] = [];

    for (const [version, data] of versions) {
      const modelBlob = data.blobs.find(
        (b: BlobInfo) =>
          b.pathname.endsWith('.safetensors') || b.pathname.endsWith('.bin')
      );

      if (modelBlob) {
        // Try to get metadata
        let metadata: ModelVersion['metadata'] = {};
        try {
          const metadataBlob = data.blobs.find((b: BlobInfo) =>
            b.pathname.endsWith('metadata.json')
          );
          if (metadataBlob) {
            const response = await readArtifact(metadataBlob.url);
            metadata = (await response.json()) as ModelVersion['metadata'];
          }
        } catch {
          // No metadata, use defaults
        }

        models.push({
          version,
          baseModel: metadata.baseModel || 'unknown',
          blobUrl: modelBlob.url,
          size: modelBlob.size,
          uploadedAt:
            modelBlob.uploadedAt instanceof Date
              ? modelBlob.uploadedAt
              : new Date(modelBlob.uploadedAt),
          metadata,
        });
      }
    }

    return models.sort(
      (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()
    );
  }

  /**
   * Delete model version
   */
  async deleteModel(version: string): Promise<void> {
    const { blobs } = await list({
      prefix: `${this.blobPrefix}${version}/`,
    });

    for (const blob of blobs) {
      await del(blob.url);
    }

    // Update database using native Drizzle
    await db
      .update(trainedModels)
      .set({
        status: 'archived',
        archivedAt: new Date(),
      })
      .where(eq(trainedModels.version, version));

    logger.info('Model deleted from Cloudflare R2', { version });
  }

  /**
   * Get latest model version
   */
  async getLatestVersion(): Promise<ModelVersion | null> {
    const models = await this.listModels();
    return models[0] || null;
  }
}

// Singleton
export const modelStorage = new ModelStorageService();
