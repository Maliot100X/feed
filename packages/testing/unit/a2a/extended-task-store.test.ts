/**
 * A2A Extended Task Store Unit Tests
 *
 * Tests for the extended task store with list functionality
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { Task } from '@a2a-js/sdk';
import { ExtendedTaskStore } from '@feed/a2a';

describe('A2A ExtendedTaskStore', () => {
  let store: ExtendedTaskStore;

  const createMockTask = (
    id: string,
    state: 'submitted' | 'working' | 'completed' | 'failed',
    contextId = 'ctx-001'
  ): Task => ({
    kind: 'task',
    id,
    contextId,
    status: {
      state,
      timestamp: new Date().toISOString(),
    },
    history: [],
  });

  beforeEach(async () => {
    store = new ExtendedTaskStore();
    await store.clear();
  });

  describe('save and load', () => {
    it('should save and load a task', async () => {
      const task = createMockTask('task-001', 'submitted');
      await store.save(task);

      const loaded = await store.load('task-001');
      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe('task-001');
      expect(loaded?.status.state).toBe('submitted');
    });

    it('should return undefined for non-existent task', async () => {
      const loaded = await store.load('non-existent');
      expect(loaded).toBeUndefined();
    });

    it('should overwrite task on save', async () => {
      const task1 = createMockTask('task-001', 'submitted');
      await store.save(task1);

      const task2 = createMockTask('task-001', 'completed');
      await store.save(task2);

      const loaded = await store.load('task-001');
      expect(loaded?.status.state).toBe('completed');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Create multiple tasks with different states and contexts
      await store.save(createMockTask('task-001', 'submitted', 'ctx-001'));
      await store.save(createMockTask('task-002', 'working', 'ctx-001'));
      await store.save(createMockTask('task-003', 'completed', 'ctx-001'));
      await store.save(createMockTask('task-004', 'failed', 'ctx-002'));
      await store.save(createMockTask('task-005', 'completed', 'ctx-002'));
    });

    it('should list all tasks', async () => {
      const result = await store.list();

      expect(result.tasks.length).toBe(5);
      expect(result.totalSize).toBe(5);
    });

    it('should filter by contextId', async () => {
      const result = await store.list({ contextId: 'ctx-001' });

      expect(result.tasks.length).toBe(3);
      expect(result.totalSize).toBe(3);
      result.tasks.forEach((task) => {
        expect(task.contextId).toBe('ctx-001');
      });
    });

    it('should filter by status', async () => {
      const result = await store.list({ status: 'completed' });

      expect(result.tasks.length).toBe(2);
      result.tasks.forEach((task) => {
        expect(task.status.state).toBe('completed');
      });
    });

    it('should combine filters', async () => {
      const result = await store.list({
        contextId: 'ctx-001',
        status: 'completed',
      });

      expect(result.tasks.length).toBe(1);
      const task = result.tasks[0];
      if (!task) throw new Error('Expected task to exist');
      expect(task.id).toBe('task-003');
    });

    it('should support pagination with pageSize', async () => {
      const result = await store.list({ pageSize: 2 });

      expect(result.tasks.length).toBe(2);
      expect(result.pageSize).toBe(2);
      expect(result.nextPageToken).not.toBe('');
    });

    it('should support pagination with pageToken', async () => {
      const page1 = await store.list({ pageSize: 2 });
      expect(page1.nextPageToken).not.toBe('');

      const page2 = await store.list({
        pageSize: 2,
        pageToken: page1.nextPageToken,
      });

      expect(page2.tasks.length).toBeGreaterThan(0);
      // Ensure no overlap
      const page1Ids = page1.tasks.map((t) => t.id);
      const page2Ids = page2.tasks.map((t) => t.id);
      page2Ids.forEach((id) => {
        expect(page1Ids).not.toContain(id);
      });
    });

    it('should return empty nextPageToken on last page', async () => {
      const result = await store.list({ pageSize: 10 }); // More than total

      expect(result.nextPageToken).toBe('');
    });

    it('should limit pageSize to 100', async () => {
      const result = await store.list({ pageSize: 200 });

      expect(result.pageSize).toBe(100);
    });

    it('should use default pageSize of 10', async () => {
      const result = await store.list();

      expect(result.pageSize).toBe(10);
    });
  });

  describe('getAllTasks', () => {
    it('should return all tasks', async () => {
      await store.save(createMockTask('task-001', 'submitted'));
      await store.save(createMockTask('task-002', 'completed'));

      const tasks = await store.getAllTasks();
      expect(tasks.length).toBe(2);
    });

    it('should return empty array when no tasks', async () => {
      const tasks = await store.getAllTasks();
      expect(tasks.length).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all tasks', async () => {
      await store.save(createMockTask('task-001', 'submitted'));
      await store.save(createMockTask('task-002', 'completed'));

      await store.clear();

      const tasks = await store.getAllTasks();
      expect(tasks.length).toBe(0);
    });
  });

  describe('history trimming', () => {
    it('should trim history when historyLength is specified', async () => {
      const task: Task = {
        kind: 'task',
        id: 'task-with-history',
        contextId: 'ctx-001',
        status: {
          state: 'completed',
          timestamp: new Date().toISOString(),
        },
        history: [
          { kind: 'message', messageId: '1', role: 'user', parts: [] },
          { kind: 'message', messageId: '2', role: 'agent', parts: [] },
          { kind: 'message', messageId: '3', role: 'user', parts: [] },
          { kind: 'message', messageId: '4', role: 'agent', parts: [] },
        ],
      };
      await store.save(task);

      const result = await store.list({ historyLength: 2 });

      expect(result.tasks.length).toBe(1);
      const firstTask = result.tasks[0];
      if (!firstTask) throw new Error('Expected task to exist');
      expect(firstTask.history?.length).toBe(2);
    });
  });

  describe('artifact handling', () => {
    it('should remove artifacts when includeArtifacts is false', async () => {
      const task: Task = {
        kind: 'task',
        id: 'task-with-artifacts',
        contextId: 'ctx-001',
        status: {
          state: 'completed',
          timestamp: new Date().toISOString(),
        },
        history: [],
        artifacts: [
          {
            artifactId: 'art-001',
            name: 'result.json',
            parts: [],
          },
        ],
      };
      await store.save(task);

      const result = await store.list({ includeArtifacts: false });

      expect(result.tasks.length).toBe(1);
      const firstTask = result.tasks[0];
      if (!firstTask) throw new Error('Expected task to exist');
      expect(firstTask.artifacts).toBeUndefined();
    });

    it('should include artifacts by default', async () => {
      const task: Task = {
        kind: 'task',
        id: 'task-with-artifacts',
        contextId: 'ctx-001',
        status: {
          state: 'completed',
          timestamp: new Date().toISOString(),
        },
        history: [],
        artifacts: [
          {
            artifactId: 'art-001',
            name: 'result.json',
            parts: [],
          },
        ],
      };
      await store.save(task);

      const result = await store.list();

      expect(result.tasks.length).toBe(1);
      const firstTask = result.tasks[0];
      if (!firstTask) throw new Error('Expected task to exist');
      expect(firstTask.artifacts).toBeDefined();
      expect(firstTask.artifacts?.length).toBe(1);
    });
  });

  describe('lifecycle and validation regressions', () => {
    it('clear() removes tasks from load() as well as list()', async () => {
      await store.save(createMockTask('task-clear', 'submitted'));
      await store.clear();
      expect(await store.load('task-clear')).toBeUndefined();
      expect((await store.list()).totalSize).toBe(0);
    });

    it('historyLength 0 returns an empty history', async () => {
      const task = createMockTask('task-hist', 'working');
      task.history = [
        {
          kind: 'message',
          messageId: 'm1',
          role: 'user',
          parts: [{ kind: 'text', text: 'hi' }],
        },
      ];
      await store.save(task);
      const result = await store.list({ historyLength: 0 });
      expect(result.tasks[0]?.history).toEqual([]);
      // Projection does not mutate the stored task.
      expect((await store.load('task-hist'))?.history).toHaveLength(1);
    });

    it('rejects invalid pagination input', async () => {
      await expect(store.list({ pageToken: 'abc' })).rejects.toThrow(
        'Invalid pageToken'
      );
      await expect(store.list({ pageToken: '-1' })).rejects.toThrow(
        'Invalid pageToken'
      );
      await expect(store.list({ pageSize: 0 })).rejects.toThrow(
        'Invalid pageSize'
      );
      await expect(store.list({ pageSize: 2.5 })).rejects.toThrow(
        'Invalid pageSize'
      );
      await expect(store.list({ historyLength: -1 })).rejects.toThrow(
        'Invalid historyLength'
      );
    });

    it('traverses every task exactly once across pages', async () => {
      for (let i = 0; i < 25; i++) {
        const task = createMockTask(`task-page-${i}`, 'completed');
        task.status.timestamp = new Date(1_700_000_000_000 + i).toISOString();
        await store.save(task);
      }
      const seen: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await store.list({ pageSize: 10, pageToken });
        seen.push(...page.tasks.map((t) => t.id));
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
      expect(seen).toHaveLength(25);
      expect(new Set(seen).size).toBe(25);
      expect(seen[0]).toBe('task-page-24');
    });

    it('returns copies so callers cannot mutate stored tasks', async () => {
      await store.save(createMockTask('task-copy', 'working'));
      const loaded = await store.load('task-copy');
      loaded!.contextId = 'tampered';
      expect((await store.load('task-copy'))?.contextId).toBe('ctx-001');
    });
  });
});
