import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from '@/lib/ai/providers';

/**
 * Daftar model free OpenCode CLI yang diaktifkan installer.
 *
 * install.sh mengambil SEMUA model free via `opencode models` lalu mengaktifkan
 * semuanya di OPENCODE_MODELS (comma-separated, bare id tanpa prefix). Tombol
 * pemilih model di Pro Workbench (/workspace) membaca daftar ini via
 * GET /api/agent/models dan memilih aktif via POST (tersimpan di
 * data/agent-driver-model.json, dipakai run berikutnya).
 */

export const OPENCODE_FREE_FALLBACK_IDS = [
  'space-bunny-free',
  'muse-spark-1.3-contributor-free',
  'big-pickle',
  'longcat-2.5-preview-free',
  'mimo-v2.6-flash-free',
  'ling-3.0-flash-fin-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free',
] as const;

export const OPENCODE_DRIVER_API = 'opencode-cli' as const;
export const OPENCODE_ACTIVE_MODEL_FILE = 'agent-driver-model.json';

function dataDir(): string {
  return path.join(process.cwd(), 'data');
}

export function activeModelFilePath(): string {
  const override = process.env.OPENCODE_ACTIVE_MODEL_FILE?.trim();
  if (override) return path.isAbsolute(override) ? override : path.join(process.cwd(), override);
  return path.join(dataDir(), OPENCODE_ACTIVE_MODEL_FILE);
}

function splitIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^opencode[/:]/, ''))
    .filter(Boolean);
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Katalog statis provider `opencode` (lib/ai/providers.ts). */
export function catalogOpencodeIds(): string[] {
  try {
    const models = PROVIDERS?.opencode?.models ?? [];
    return models.map((m) => m.id).filter(Boolean);
  } catch {
    return [...OPENCODE_FREE_FALLBACK_IDS];
  }
}

/**
 * SEMUA model free yang diaktifkan: OPENCODE_MODELS bila terisi, else katalog.
 * Nilai operator eksplisit dihormati apa adanya (tanpa menyuntik default) —
 * installer yang memastikan default ikut saat menulis daftar.
 */
export function activatedOpencodeIds(): string[] {
  const fromEnv = dedupe(splitIds(process.env.OPENCODE_MODELS));
  if (fromEnv.length > 0) return fromEnv;
  return dedupe(catalogOpencodeIds());
}

export interface ActivatedOpencodeModel {
  id: string;
  modelString: string;
  name: string;
  contextWindow?: number;
  outputWindow?: number;
}

export function activatedOpencodeModels(): ActivatedOpencodeModel[] {
  const catalog = new Map((PROVIDERS?.opencode?.models ?? []).map((m) => [m.id, m]));
  return activatedOpencodeIds().map((id) => {
    const info = catalog.get(id);
    return {
      id,
      modelString: `opencode:${id}`,
      name: info?.name ?? id,
      ...(info?.contextWindow ? { contextWindow: info.contextWindow } : {}),
      ...(info?.outputWindow ? { outputWindow: info.outputWindow } : {}),
    };
  });
}

export function normalizeOpencodeModelInput(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const bare = trimmed.replace(/^opencode[/:]/, '').trim();
  if (!bare || /[\s"{}]/.test(bare)) return null;
  return bare;
}

export function isActivatedOpencodeId(id: string): boolean {
  return activatedOpencodeIds().includes(id);
}

interface ActiveModelFile {
  model?: string;
  api?: string;
  updatedAt?: number;
}

/** Override aktif dari tombol workbench (file data/), null bila belum ada. */
export function readActiveModelOverride(): { modelString: string; api: string } | null {
  try {
    const file = activeModelFilePath();
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ActiveModelFile;
    const bare = normalizeOpencodeModelInput(parsed.model ?? '');
    if (!bare || !isActivatedOpencodeId(bare)) return null;
    return { modelString: `opencode:${bare}`, api: parsed.api || OPENCODE_DRIVER_API };
  } catch {
    return null;
  }
}

/** Simpan pilihan tombol workbench; melempar bila di luar allowlist. */
export function writeActiveModelOverride(rawModel: string): { modelString: string; api: string } {
  const bare = normalizeOpencodeModelInput(rawModel);
  if (!bare) throw new Error('Model tidak valid (contoh: opencode:muse-spark-1.3-contributor-free).');
  if (!isActivatedOpencodeId(bare)) {
    throw new Error(
      `Model "${bare}" tidak ada di daftar aktif (OPENCODE_MODELS). Pilih dari tombol pemilih model.`,
    );
  }
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const payload: ActiveModelFile = {
    model: `opencode:${bare}`,
    api: OPENCODE_DRIVER_API,
    updatedAt: Date.now(),
  };
  const tmp = path.join(
    dir,
    `${OPENCODE_ACTIVE_MODEL_FILE}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`,
  );
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, activeModelFilePath());
  return { modelString: payload.model!, api: payload.api! };
}

/** Default tier3 = muse-spark bila aktif, else entri pertama daftar aktif. */
export function defaultTier3ModelString(): string {
  const ids = activatedOpencodeIds();
  if (ids.includes('muse-spark-1.3-contributor-free')) {
    return 'opencode:muse-spark-1.3-contributor-free';
  }
  const first = ids[0];
  if (first) return `opencode:${first}`;
  return `opencode:${OPENCODE_FREE_FALLBACK_IDS[1]}`;
}
