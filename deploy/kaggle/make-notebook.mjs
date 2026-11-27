#!/usr/bin/env node
/**
 * Build the Kaggle deployment notebook from `kelaska-vercel-kernel.py`.
 *
 * Notebooks are git-ignored in this repository (they are easy to fill with
 * secrets by accident), so the kernel lives as a plain Python script with
 * `# %%` cell markers and this script materialises the `.ipynb` next to it.
 *
 *   node deploy/kaggle/make-notebook.mjs [--out FILE]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let out = resolve(root, 'KelasKA-Kaggle-Deploy.ipynb');
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--out' && args[index + 1]) {
    out = resolve(process.cwd(), args[index + 1]);
    index += 1;
  }
}

const source = await readFile(resolve(here, 'kelaska-vercel-kernel.py'), 'utf8');
const lines = source.split('\n');

/** @type {Array<{ cell_type: 'markdown'|'code', metadata: object, source: string[], ... }>} */
const cells = [];
let current = null;
let kind = 'code';

function flush() {
  if (!current) return;
  // Drop the blank line that separates a cell marker from its body.
  while (current.length && current[current.length - 1].trim() === '') current.pop();
  if (!current.length) return;
  if (kind === 'markdown') {
    const text = current.map((line) => line.replace(/^# ?/, '')).join('\n');
    cells.push({
      cell_type: 'markdown',
      metadata: {},
      source: text.split('\n').map((line, i, all) => (i === all.length - 1 ? line : `${line}\n`)),
    });
  } else {
    cells.push({
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: current.map((line, i, all) => (i === all.length - 1 ? line : `${line}\n`)),
    });
  }
  current = null;
}

for (const line of lines) {
  const marker = /^# %%(.*)$/.exec(line);
  if (marker) {
    flush();
    const tag = marker[1].trim();
    kind = tag === '[markdown]' ? 'markdown' : 'code';
    current = [];
    continue;
  }
  if (current) current.push(line);
}

flush();

const notebook = {
  cells,
  metadata: {
    kernelspec: {
      display_name: 'Python 3',
      language: 'python',
      name: 'python3',
    },
    language_info: {
      name: 'python',
      version: '3.11',
    },
    kaggle: {
      accelerator: 'nvidiaTeslaT4',
      dataSources: [],
      isGpuEnabled: true,
      isInternetEnabled: true,
    },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

await writeFile(out, `${JSON.stringify(notebook, null, 1)}\n`, 'utf8');
console.log(`wrote ${out} (${cells.length} cells)`);
