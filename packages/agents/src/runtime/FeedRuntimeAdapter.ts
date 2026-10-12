import { InMemoryDatabaseAdapter } from '@elizaos/core';

/**
 * Process-local Eliza metadata. Feed's durable chat, portfolio and trajectory
 * records live in PostgreSQL and are loaded by Feed providers on every turn.
 * Use the SDK's batch API rather than fake-success single-item adapter stubs.
 */
export class FeedRuntimeAdapter extends InMemoryDatabaseAdapter {
  // The SDK adapter currently discards these writes. Reject unsupported
  // capabilities explicitly so callers cannot believe state was persisted.
  override async createComponents(): Promise<never> {
    throw new Error('Runtime component storage is not configured');
  }

  override async updateComponents(): Promise<never> {
    throw new Error('Runtime component storage is not configured');
  }

  override async upsertComponents(): Promise<never> {
    throw new Error('Runtime component storage is not configured');
  }

  override async patchComponents(): Promise<never> {
    throw new Error('Runtime component storage is not configured');
  }

  override async deleteComponents(): Promise<never> {
    throw new Error('Runtime component storage is not configured');
  }

  override async createRelationships(): Promise<never> {
    throw new Error('Runtime relationship storage is not configured');
  }

  override async updateRelationships(): Promise<never> {
    throw new Error('Runtime relationship storage is not configured');
  }

  override async deleteRelationships(): Promise<never> {
    throw new Error('Runtime relationship storage is not configured');
  }
}
