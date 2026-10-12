/**
 * JSON storage snapshot / lifecycle regression tests.
 *
 * Covers: adapters staying attached to provider state across loads (D01),
 * memory mode doing no implicit disk I/O (D02), Date restoration on snapshot
 * load (D03), and rejecting unsupported storage modes (D04).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStorageProvider, parseJsonStorageState } from '../adapters/json';
import { createStorageProvider } from '../factory';
import {
  clearStorageProvider,
  hasStorageProvider,
  type StorageProviderConfig,
} from '../ports/storage-provider';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feed-storage-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  clearStorageProvider();
});

async function seededSnapshot(dir: string): Promise<string> {
  const source = new JsonStorageProvider({
    mode: 'json',
    jsonBasePath: dir,
    persistOnChange: false,
  });
  await source.initialize();
  await source.users.createUser({
    id: 'user-1',
    username: 'alice',
    isAgent: false,
    virtualBalance: '100',
    totalDeposited: '0',
    reputationPoints: 0,
    lifetimePnL: '0',
  });
  await source.posts.createPost({
    id: 'post-old',
    type: 'post',
    content: '2024-01-01T00:00:00.000Z',
    authorId: 'user-1',
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
  });
  await source.posts.createPost({
    id: 'post-new',
    type: 'post',
    content: 'newer',
    authorId: 'user-1',
    timestamp: new Date('2024-02-01T00:00:00.000Z'),
  });
  await source.game.initializeGame();
  await source.game.createEvent({
    id: 'event-1',
    eventType: 'news',
    description: 'something',
    actors: [],
    visibility: 'public',
    dayNumber: 1,
  });
  await source.saveSnapshot();
  return join(dir, 'state.json');
}

describe('JsonStorageProvider snapshot loading (D01/D03)', () => {
  test('initialize() from state.json is visible through adapters with Date fields restored', async () => {
    const dir = makeTempDir();
    await seededSnapshot(dir);

    const provider = new JsonStorageProvider({
      mode: 'json',
      jsonBasePath: dir,
      persistOnChange: false,
    });
    await provider.initialize();

    const user = await provider.users.getUser('user-1');
    expect(user?.username).toBe('alice');
    expect(user?.createdAt).toBeInstanceOf(Date);

    const posts = await provider.posts.getRecentPosts();
    expect(posts.items.map((p) => p.id)).toEqual(['post-new', 'post-old']);
    expect(posts.items[0]!.timestamp).toBeInstanceOf(Date);
    // Free-form content that looks like a timestamp stays a string.
    expect(posts.items[1]!.content).toBe('2024-01-01T00:00:00.000Z');

    const game = await provider.game.getGameState();
    expect(game?.createdAt).toBeInstanceOf(Date);
    const events = await provider.game.getRecentEvents(10);
    expect(events[0]!.timestamp).toBeInstanceOf(Date);

    // Metadata timestamps remain ISO strings.
    expect(typeof provider.getState().metadata.updatedAt).toBe('string');
  });

  test('writes after loadSnapshot() land in the saved snapshot', async () => {
    const snapshotPath = await seededSnapshot(makeTempDir());
    const dir = makeTempDir();
    const provider = new JsonStorageProvider({
      mode: 'json',
      jsonBasePath: dir,
      persistOnChange: false,
    });
    await provider.initialize();
    await provider.loadSnapshot(snapshotPath);

    expect((await provider.users.getUser('user-1'))?.username).toBe('alice');
    await provider.users.updateUser('user-1', { username: 'alice2' });
    await provider.saveSnapshot();

    const saved = parseJsonStorageState(
      readFileSync(join(dir, 'state.json'), 'utf-8')
    );
    expect(saved.users?.['user-1']?.username).toBe('alice2');
    expect(saved.posts?.['post-old']).toBeDefined();
  });

  test('setState() immediately affects every adapter', async () => {
    const provider = new JsonStorageProvider({ mode: 'memory' });
    await provider.initialize();
    const state = provider.getState();

    provider.setState({
      users: {
        u: {
          id: 'u',
          username: 'bob',
          isAgent: false,
          virtualBalance: '0',
          totalDeposited: '0',
          reputationPoints: 0,
          lifetimePnL: '0',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });

    expect(provider.getState()).toBe(state);
    expect((await provider.users.getUserByUsername('bob'))?.id).toBe('u');
  });

  test('invalid date strings fail loudly', () => {
    expect(() =>
      parseJsonStorageState(
        JSON.stringify({
          posts: {
            p: { id: 'p', timestamp: 'not-a-date' },
          },
        })
      )
    ).toThrow(/posts\.timestamp/);
  });

  test('missing optional dates stay undefined', () => {
    const state = parseJsonStorageState(
      JSON.stringify({
        posts: { p: { id: 'p', timestamp: '2024-01-01T00:00:00.000Z' } },
      })
    );
    expect(state.posts?.p?.deletedAt).toBeUndefined();
    expect(state.posts?.p?.timestamp).toBeInstanceOf(Date);
  });
});

describe('memory mode (D02)', () => {
  test('does not create, read, or write the base directory', async () => {
    const parent = makeTempDir();
    const missing = join(parent, 'does-not-exist');
    const provider = new JsonStorageProvider({
      mode: 'memory',
      jsonBasePath: missing,
    });
    await provider.initialize();
    await provider.users.createUser({
      id: 'u',
      username: 'x',
      isAgent: false,
      virtualBalance: '0',
      totalDeposited: '0',
      reputationPoints: 0,
      lifetimePnL: '0',
    });
    await provider.shutdown();
    expect(existsSync(missing)).toBe(false);
    expect(provider.mode).toBe('memory');
  });

  test('ignores an existing state.json on disk', async () => {
    const dir = makeTempDir();
    await seededSnapshot(dir);
    const before = readFileSync(join(dir, 'state.json'), 'utf-8');

    const provider = new JsonStorageProvider({
      mode: 'memory',
      jsonBasePath: dir,
      persistOnChange: true,
    });
    await provider.initialize();
    expect(await provider.users.getUser('user-1')).toBeNull();
    await provider.users.createUser({
      id: 'u2',
      username: 'y',
      isAgent: false,
      virtualBalance: '0',
      totalDeposited: '0',
      reputationPoints: 0,
      lifetimePnL: '0',
    });
    await provider.shutdown();
    expect(readFileSync(join(dir, 'state.json'), 'utf-8')).toBe(before);
  });

  test('saveSnapshot() without explicit location throws', async () => {
    const provider = new JsonStorageProvider({ mode: 'memory' });
    await provider.initialize();
    await expect(provider.saveSnapshot()).rejects.toThrow(
      /no snapshot location/
    );
  });

  test('json mode reports json', async () => {
    const dir = makeTempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), '{}');
    const provider = new JsonStorageProvider({
      mode: 'json',
      jsonBasePath: dir,
      persistOnChange: false,
    });
    await provider.initialize();
    expect(provider.mode).toBe('json');
  });
});

describe('createStorageProvider (D04)', () => {
  test('rejects unsupported modes before registering a global provider', async () => {
    const config = JSON.parse('{"mode":"postgres"}') as StorageProviderConfig;
    await expect(createStorageProvider(config)).rejects.toThrow(
      /Unsupported storage mode: postgres/
    );
    expect(hasStorageProvider()).toBe(false);
  });
});
