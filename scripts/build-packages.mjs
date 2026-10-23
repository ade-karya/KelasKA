#!/usr/bin/env node
/**
 * Build the workspace packages in dependency order.
 *
 * The repository defaults to Bun, but this script also works from the legacy
 * Node/pnpm installer: it uses Bun when available and falls back to npm. The
 * final sync steps always run with the current JavaScript runtime, so a
 * Bun-only host does not need Node.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const packages = [
  'mathml2omml',
  'pptxgenjs',
  '@openmaic/dsl',
  '@openmaic/geometry',
  '@openmaic/generation',
  '@openmaic/storage',
  '@openmaic/importer',
  '@openmaic/renderer',
  '@openmaic/editor',
];

function hasCommand(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

const runner = hasCommand('bun') ? 'bun' : process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const name of packages) {
  const directory = join(root, 'packages', name);
  if (!existsSync(join(directory, 'package.json'))) {
    console.error(`[build-packages] Missing package manifest: ${directory}`);
    process.exit(1);
  }
  console.log(`\n[build-packages] ${name}`);
  run(runner, ['run', 'build'], directory);
}

run(process.execPath, ['scripts/sync-maic-importer.mjs']);
run(process.execPath, ['scripts/sync-interactive-assets.mjs']);
