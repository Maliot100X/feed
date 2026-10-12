/**
 * `feed build` — Bundle the runtime and discovered systems into a standalone output.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { defineCommand } from 'citty';
import consola from 'consola';
import { loadFeedConfig } from '../../core/config';
import { scanSystems } from '../../core/scanner';

export default defineCommand({
  meta: {
    name: 'build',
    description: 'Build the runtime and systems into a standalone bundle',
  },
  args: {
    rootDir: {
      type: 'string',
      description: 'Project root directory',
      default: '.',
    },
    outDir: {
      type: 'string',
      description: 'Output directory',
      default: '.output',
    },
    minify: {
      type: 'boolean',
      description: 'Minify the output',
      default: false,
    },
    sourcemap: {
      type: 'string',
      description: 'Sourcemap mode (none, inline, external)',
      default: 'none',
    },
    target: {
      type: 'string',
      description: 'Build target (bun, node)',
      default: 'bun',
    },
  },
  async run({ args }) {
    const rootDir = resolve(args.rootDir);
    const outDir = resolve(rootDir, args.outDir);

    consola.box('Feed Runtime — build');

    const { config, configFile } = await loadFeedConfig(rootDir);
    consola.info(`Config: ${configFile ?? 'defaults'}`);

    // Discover systems
    const { systems, files } = await scanSystems(
      config.systemsDir ?? './systems',
      rootDir
    );
    consola.info(
      `Discovered ${systems.length} system(s) from ${files.length} file(s)`
    );

    if (systems.length === 0 && files.length === 0) {
      consola.warn('No systems found — building entry only');
    }

    // Framework modules are resolved from this package's source, not from the
    // project root (which may be an external project using @feed/sim).
    const toImportPath = (f: string) => {
      const rel = relative(outDir, f).replace(/\\/g, '/');
      return rel.startsWith('.') ? rel : `./${rel}`;
    };
    const frameworkPath = (file: string) =>
      toImportPath(resolve(import.meta.dir, '../../core', file));
    const runtimePath = frameworkPath('runtime.ts');
    const configPath = frameworkPath('config.ts');
    const systemImports = files.map(
      (f, i) => `import * as _sys${i} from '${toImportPath(f)}';`
    );
    const systemResolutions = files.map(
      (f, i) => `  ...resolveModuleSystems(_sys${i}, ${JSON.stringify(f)}),`
    );

    const entrySource = `#!/usr/bin/env bun
/**
 * Feed Runtime — built entry point
 * Generated at ${new Date().toISOString()}
 *
 * System resolution, config overrides and engine construction come from the
 * shared runtime module so built and dev/CLI registration behave identically.
 */

import {
  createEngineFromConfig,
  registerSystems,
  resolveModuleSystems,
} from '${runtimePath}';
import { loadFeedConfig } from '${configPath}';

${systemImports.join('\n')}

const systems = [
${systemResolutions.join('\n')}
];

const { config: runtimeConfig } = await loadFeedConfig();
const engine = createEngineFromConfig(runtimeConfig);
registerSystems(engine, systems, runtimeConfig);

await engine.boot();

const once = process.env.SIM_ONCE === '1' || process.argv.includes('--once');

if (once) {
  const start = Date.now();
  const metrics = await engine.tick();
  console.log(JSON.stringify({ ok: true, durationMs: Date.now() - start, metrics }, null, 2));
  await engine.shutdown();
  process.exit(0);
} else {
  let running = true;
  const cleanup = async () => {
    running = false;
    await engine.shutdown();
    process.exit(0);
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  const intervalMs = Math.max(1000, Number(process.env.TICK_INTERVAL_MS) || 60000);

  while (running) {
    await engine.tick();
    if (running) await new Promise(r => setTimeout(r, intervalMs));
  }
}
`;

    await mkdir(outDir, { recursive: true });

    const entryPath = resolve(outDir, 'server.ts');
    await writeFile(entryPath, entrySource, 'utf-8');
    consola.success(`Entry written: ${relative(rootDir, entryPath)}`);

    // Bundle with bun build — externalize native and heavy deps
    const externals = [
      'pg-native',
      'better-sqlite3',
      'mysql2',
      'oracledb',
      'tedious',
      'pg-query-stream',
      'node-fetch-native',
      'node-fetch-native/*',
      '@solana/*',
    ];

    const buildArgs = [
      'build',
      entryPath,
      '--outdir',
      outDir,
      '--target',
      args.target,
      ...externals.flatMap((e) => ['--external', e]),
    ];

    if (args.minify) buildArgs.push('--minify');
    if (args.sourcemap === 'inline') buildArgs.push('--sourcemap=inline');
    else if (args.sourcemap === 'external')
      buildArgs.push('--sourcemap=external');

    consola.start(`Bundling with bun build (target: ${args.target})...`);

    const proc = Bun.spawn(['bun', ...buildArgs], {
      cwd: rootDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      consola.error('Build failed');
      if (stdout) consola.log(stdout);
      if (stderr) consola.error(stderr);
      throw new Error(`bun build exited with code ${exitCode}`);
    }

    if (stdout) consola.log(stdout.trim());

    // Write a manifest
    const manifest = {
      buildTime: new Date().toISOString(),
      target: args.target,
      minify: args.minify,
      systems: systems.map((m) => ({
        id: m.id,
        name: m.name,
        phase: m.phase,
        file:
          files.find(
            (f) => basename(f).replace(/\.(ts|js|mts|mjs)$/, '') === m.id
          ) ?? null,
      })),
      config: {
        budgetMs: config.budgetMs ?? 60_000,
        systemsDir: config.systemsDir ?? './systems',
      },
    };

    const manifestPath = resolve(outDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    consola.success(`Build complete → ${relative(rootDir, outDir)}/`);
    consola.info(
      `  Run with: bun ${relative(rootDir, resolve(outDir, 'server.js'))}`
    );
    process.exit(0);
  },
});
