#!/usr/bin/env node
/**
 * Build the workspace packages in dependency order.
 *
 * The repository defaults to Bun, but this script also works from the legacy
 * Node/pnpm installer: it uses Bun when available and falls back to npm. The
 * final sync steps always run with the current JavaScript runtime, so a
 * Bun-only host does not need Node.
 *
 * Packages whose dependencies are already built run concurrently (two at a
 * time on a normal Colab runtime) so the long @openmaic/importer bundle
 * overlaps the renderer/editor builds instead of waiting behind them.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, totalmem } from 'node:os';
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

/** Workspace dependencies of a package, used to schedule builds. */
function workspaceDependencies(name) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
  const dependencies = new Set();
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[field] || {})) {
      if (packages.includes(dependency)) dependencies.add(dependency);
    }
  }
  return dependencies;
}

function buildPackage(name) {
  const directory = join(root, 'packages', name);
  if (!existsSync(join(directory, 'package.json'))) {
    return Promise.reject(new Error(`[build-packages] Missing package manifest: ${directory}`));
  }
  console.log(`\n[build-packages] ${name}`);
  return new Promise((resolve, reject) => {
    const child = spawn(runner, ['run', 'build'], {
      cwd: directory,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`[build-packages] ${name} gagal (${signal || `exit ${code}`})`));
    });
  });
}

async function buildWorkspacePackages() {
  const dependencies = new Map(packages.map((name) => [name, workspaceDependencies(name)]));
  const cpuCount =
    typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  const ramGb = totalmem() / 1024 ** 3;
  // Two bundlers fit on a 2-vCPU/8 GB Colab runtime; a larger host can run
  // three or four (each build is one esbuild/tsc process). Small runtimes stay
  // serial so the build does not swap.
  let concurrency = 1;
  if (cpuCount >= 2 && ramGb >= 7) concurrency = 2;
  if (cpuCount >= 4 && ramGb >= 12) concurrency = Math.min(4, Math.floor(cpuCount / 2) + 1);
  // Operator/benchmark override; an invalid value keeps the adaptive default.
  const forcedConcurrency = Number.parseInt(
    process.env.OPENMAIC_BUILD_PACKAGES_CONCURRENCY || '',
    10,
  );
  if (Number.isFinite(forcedConcurrency) && forcedConcurrency > 0) {
    concurrency = forcedConcurrency;
  }
  console.log(
    `[build-packages] ${cpuCount} vCPU, ${Math.round(ramGb)} GB RAM -> maks ${concurrency} build paralel.`,
  );
  const pending = new Set(packages);
  const finished = new Set();
  let running = 0;
  let firstError = null;

  await new Promise((resolve) => {
    const pump = () => {
      while (!firstError && running < concurrency) {
        const next = [...pending].find((name) =>
          [...dependencies.get(name)].every((dependency) => finished.has(dependency)),
        );
        if (!next) break;
        pending.delete(next);
        running += 1;
        buildPackage(next).then(
          () => {
            finished.add(next);
            running -= 1;
            console.log(`[build-packages] ${next} selesai.`);
            pump();
          },
          (error) => {
            running -= 1;
            firstError ||= error;
            pump();
          },
        );
      }
      if (running === 0) resolve();
    };
    pump();
  });

  if (firstError) throw firstError;
  if (pending.size > 0) {
    throw new Error(`[build-packages] dependency cycle: ${[...pending].join(', ')}`);
  }
}

// Rebuilding every package on each `bun install` costs ~3 minutes on a small
// Colab runtime even when nothing changed. Keep a content hash of the package
// sources next to node_modules and skip the builds when it matches.
const STAMP_FILE = join(root, 'node_modules', '.kelaska-build-packages.sha256');
const HASHED_ROOT_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'bun.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
];
const SKIPPED_DIRS = new Set(['dist', 'node_modules']);

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function sourceHash() {
  const hash = createHash('sha256');
  // Fast installs skip minifying the unused UMD/CJS importer bundles, so a
  // mode switch must rebuild instead of reusing the previous dist.
  hash.update(`fast-minify:${process.env.OPENMAIC_FAST_MINIFY === '1' ? '1' : '0'}\0`);
  const files = [];
  for (const name of HASHED_ROOT_FILES) {
    const file = join(root, name);
    if (existsSync(file)) files.push(file);
  }
  for (const name of packages) {
    files.push(...collectFiles(join(root, 'packages', name)));
  }
  for (const file of files.sort()) {
    hash.update(file.slice(root.length + 1));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const outputsExist = packages.every((name) => existsSync(join(root, 'packages', name, 'dist')));
const currentHash = sourceHash();
const previousHash = existsSync(STAMP_FILE) ? readFileSync(STAMP_FILE, 'utf8').trim() : '';

if (outputsExist && currentHash === previousHash) {
  console.log('[build-packages] sources unchanged — skipping package builds.');
} else {
  // Drop the stamp first: an interrupted build must never look "up to date".
  rmSync(STAMP_FILE, { force: true });
  try {
    await buildWorkspacePackages();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  mkdirSync(dirname(STAMP_FILE), { recursive: true });
  writeFileSync(STAMP_FILE, `${currentHash}\n`);
}

run(process.execPath, ['scripts/sync-maic-importer.mjs']);
run(process.execPath, ['scripts/sync-interactive-assets.mjs']);
if (existsSync(join(root, 'scripts', 'prepare-code-editor.mjs'))) {
  run(process.execPath, ['scripts/prepare-code-editor.mjs']);
}
