/**
 * Regression tests for engine lifecycle ordering (D05), engine context
 * isolation across instances (D06), scanner failure propagation (D07), and
 * the shared runtime used by both CLI and built entry (D16).
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DrizzleClient } from '@feed/db';
import type { Logger } from '@feed/shared';
import { _engine, useEngine } from '../core/composables';
import { FeedEngine } from '../core/engine';
import { FrameworkError } from '../core/errors';
import {
  applyPhaseOverride,
  registerSystems,
  resolveModuleSystems,
} from '../core/runtime';
import { scanSystems } from '../core/scanner';
import type { EngineContext, FeedSystem } from '../core/types';
import { TickPhase } from '../core/types';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as Partial<Logger> as Logger;

function makeTestEngine() {
  return new FeedEngine({
    db: {} as DrizzleClient,
    llm: { execute: async () => ({}) as never, getClient: () => ({}) },
    logger: silentLogger,
    config: { budgetMs: 60_000 },
  });
}

function makeSystem(
  overrides: Partial<FeedSystem> & { id: string; phase: TickPhase }
): FeedSystem {
  return { name: overrides.id, onTick: async () => ({}), ...overrides };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sim-runtime-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('engine dependency lifecycle (D05)', () => {
  it('accepts a dependent registered before its provider', async () => {
    const order: string[] = [];
    const engine = makeTestEngine();
    engine.use(
      makeSystem({
        id: 'dependent',
        phase: TickPhase.Events,
        dependencies: ['provider'],
        onTick: async () => {
          order.push('dependent');
          return {};
        },
      })
    );
    engine.use(
      makeSystem({
        id: 'provider',
        phase: TickPhase.Events,
        onTick: async () => {
          order.push('provider');
          return {};
        },
      })
    );
    await engine.boot();
    await engine.tick();
    await engine.shutdown();
    expect(order).toEqual(['provider', 'dependent']);
  });

  it('rejects a dependency scheduled in a later phase', async () => {
    const engine = makeTestEngine();
    engine.use(
      makeSystem({
        id: 'early',
        phase: TickPhase.Bootstrap,
        dependencies: ['late'],
      })
    );
    engine.use(makeSystem({ id: 'late', phase: TickPhase.Social }));
    await expect(engine.boot()).rejects.toThrow(/later phase/);
  });

  it('rejects duplicate IDs in the same phase', () => {
    const engine = makeTestEngine();
    engine.use(makeSystem({ id: 'dup', phase: TickPhase.Events }));
    expect(() =>
      engine.use(makeSystem({ id: 'dup', phase: TickPhase.Events }))
    ).toThrow(/Duplicate system ID "dup"/);
  });

  it('rejects duplicate IDs across phases', () => {
    const engine = makeTestEngine();
    engine.use(makeSystem({ id: 'dup', phase: TickPhase.Events }));
    expect(() =>
      engine.use(makeSystem({ id: 'dup', phase: TickPhase.Social }))
    ).toThrow(FrameworkError);
  });

  it('tears down dependents before their dependencies', async () => {
    const order: string[] = [];
    const engine = makeTestEngine();
    engine.use(
      makeSystem({
        id: 'consumer',
        phase: TickPhase.Markets,
        dependencies: ['producer'],
        destroy: async () => {
          order.push('consumer');
        },
      })
    );
    engine.use(
      makeSystem({
        id: 'producer',
        phase: TickPhase.Markets,
        destroy: async () => {
          order.push('producer');
        },
      })
    );
    await engine.boot();
    await engine.shutdown();
    expect(order).toEqual(['consumer', 'producer']);
  });
});

describe('engine context isolation (D06)', () => {
  it('shutting down the old engine keeps the new engine context active', async () => {
    let seenInTick: EngineContext | undefined;
    let registeredCtx: EngineContext | undefined;

    const prev = makeTestEngine();
    prev.use(makeSystem({ id: 'old', phase: TickPhase.Events }));
    await prev.boot();

    const next = makeTestEngine();
    next.use(
      makeSystem({
        id: 'new',
        phase: TickPhase.Events,
        register: async (ctx) => {
          registeredCtx = ctx;
        },
        onTick: async () => {
          seenInTick = useEngine();
          return {};
        },
      })
    );
    await next.boot();
    await prev.shutdown();

    await next.tick();
    expect(seenInTick).toBe(registeredCtx);
    expect(_engine.tryUse() ?? undefined).toBe(registeredCtx);

    await next.shutdown();
    expect(_engine.tryUse() ?? undefined).toBeUndefined();
  });

  it('binds each engine context during its own tick', async () => {
    const seen: Record<string, EngineContext | undefined> = {};
    const ctxs: Record<string, EngineContext | undefined> = {};
    const makeEngine = (id: string) => {
      const engine = makeTestEngine();
      engine.use(
        makeSystem({
          id,
          phase: TickPhase.Events,
          register: async (ctx) => {
            ctxs[id] = ctx;
          },
          onTick: async () => {
            seen[id] = useEngine();
            return {};
          },
        })
      );
      return engine;
    };
    const a = makeEngine('a');
    const b = makeEngine('b');
    await a.boot();
    await b.boot();
    await a.tick();
    await b.tick();
    expect(seen.a).toBe(ctxs.a);
    expect(seen.b).toBe(ctxs.b);
    await a.shutdown();
    await b.shutdown();
  });
});

describe('scanner failure propagation (D07)', () => {
  it('rejects with the file path when a system file fails to load', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'broken.ts');
      await writeFile(
        file,
        `throw new Error('load failure');\nexport default {};`,
        'utf-8'
      );
      await expect(scanSystems('.', dir)).rejects.toThrow(
        /broken\.ts: load failure/
      );
    });
  });

  it('reports the export and file when a system class constructor throws', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'ctor.ts'),
        `export class BadSystem { constructor() { throw new Error('ctor boom'); } }`,
        'utf-8'
      );
      await expect(scanSystems('.', dir)).rejects.toThrow(
        /"BadSystem" from .*ctor\.ts: ctor boom/
      );
    });
  });

  it('never invokes plain helper functions', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'helpers.ts'),
        `export function helper() { (globalThis as Record<string, unknown>).__simHelperCalled = true; }`,
        'utf-8'
      );
      const result = await scanSystems('.', dir);
      expect(result.systems).toEqual([]);
      expect(
        (globalThis as Record<string, unknown>).__simHelperCalled
      ).toBeUndefined();
    });
  });

  it('fresh scans pick up changed system files', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'sys.ts');
      const write = (name: string) =>
        writeFile(
          file,
          `export default { id: 'sys', name: '${name}', phase: 300, onTick: async () => ({}) };`,
          'utf-8'
        );
      await write('first');
      const first = await scanSystems('.', dir, { fresh: true });
      expect(first.systems[0]!.name).toBe('first');
      await write('second');
      const second = await scanSystems('.', dir, { fresh: true });
      expect(second.systems[0]!.name).toBe('second');
    });
  });
});

describe('shared runtime (D16)', () => {
  it('dedupes the same value exported as default and named', () => {
    const sys = makeSystem({ id: 'same', phase: TickPhase.Events });
    const systems = resolveModuleSystems({ default: sys, sys }, 'mod.ts');
    expect(systems).toEqual([sys]);
  });

  it('registers named systems alongside a default export', () => {
    const a = makeSystem({ id: 'a', phase: TickPhase.Events });
    const b = makeSystem({ id: 'b', phase: TickPhase.Events });
    const systems = resolveModuleSystems({ default: a, b }, 'mod.ts');
    expect(systems.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('phase override on a frozen class instance keeps register/destroy hooks bound', async () => {
    const calls: string[] = [];
    class Frozen implements FeedSystem {
      readonly id = 'frozen';
      readonly name = 'Frozen';
      readonly phase: TickPhase = TickPhase.Events;
      private readonly label = 'bound';
      async register() {
        calls.push(`register:${this.label}`);
      }
      async onTick() {
        calls.push(`tick:${this.label}`);
        return {};
      }
      async destroy() {
        calls.push(`destroy:${this.label}`);
      }
    }
    const instance = Object.freeze(new Frozen());
    const engine = makeTestEngine();
    const registered = registerSystems(engine, [instance], {
      systemPhases: { frozen: TickPhase.Social },
    });
    expect(registered).toBe(1);
    await engine.boot();
    await engine.tick();
    await engine.shutdown();
    expect(calls).toEqual(['register:bound', 'tick:bound', 'destroy:bound']);
  });

  it('ignores invalid phase overrides', () => {
    const sys = makeSystem({ id: 'x', phase: TickPhase.Events });
    expect(applyPhaseOverride(sys, 12345).phase).toBe(TickPhase.Events);
    expect(applyPhaseOverride(sys, 'soon').phase).toBe(TickPhase.Events);
  });

  it('skips disabled systems', () => {
    const engine = makeTestEngine();
    const count = registerSystems(
      engine,
      [makeSystem({ id: 'off', phase: TickPhase.Events })],
      { disabledSystems: ['off'] }
    );
    expect(count).toBe(0);
  });
});
