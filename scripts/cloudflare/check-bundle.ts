#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const environment = process.argv[2];
if (environment !== 'staging' && environment !== 'production')
  throw new Error('Specify staging or production');
const result = spawnSync(
  'bun',
  [
    'x',
    'wrangler',
    'deploy',
    '--dry-run',
    '--config',
    `wrangler.${environment}.jsonc`,
  ],
  { cwd: resolve(import.meta.dir, '../../apps/web'), encoding: 'utf8' }
);
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Worker dry run failed');
const match = /Total Upload:.*?gzip:\s*([\d.]+) KiB/.exec(result.stdout);
if (!match) throw new Error('Wrangler did not report compressed Worker size');
const size = Number(match[1]);
if (!Number.isFinite(size) || size > 10 * 1024)
  throw new Error(
    `Worker is ${size} KiB compressed; paid Workers allow 10240 KiB`
  );
console.info(`Worker upload budget passed: ${size} / 10240 KiB`);
