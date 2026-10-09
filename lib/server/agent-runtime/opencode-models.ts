import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS, OPENCODE_CLI_THINKING } from '@/lib/ai/providers';
import { getDefaultThinkingConfig, normalizeThinkingConfig } from '@/lib/ai/thinking-config';
import type { ThinkingCapability, ThinkingConfig } from '@/lib/types/provider';

/**
 * Daftar model CLI OpenCode yang diaktifkan installer untuk Pro Workbench.
 *
 * Dua provider CLI (`opencode` dan `opencode-go`, keduanya dieksekusi lokal
 * via `opencode run`, pola nexu-io/open-design):
 * - install.sh mengambil SEMUA model `opencode/*` + `opencode-go/*` via
 *   `opencode models` (login-aware untuk `opencode/`, live untuk
 *   `opencode-go/`) lalu mengaktifkan masing-masing di OPENCODE_MODELS /
 *   OPENCODE_GO_MODELS (comma-separated, bare id tanpa prefix). Bila pemilik
 *   sesi belum login, OPENCODE_GO_MODELS ditulis KOSONG sehingga grup Go
 *   disembunyikan dari pemilih (login lalu jalankan ulang installer untuk
 *   memunculkannya).
 * - Tombol pemilih model di Pro Workbench (/workspace) membaca daftar ini via
 *   GET /api/agent/models dan memilih aktif (+ varian thinking per model)
 *   via POST (tersimpan di data/agent-driver-model.json, dipakai run
 *   berikutnya tanpa restart).
 */

export const OPENCODE_CLI_PROVIDERS = ['opencode', 'opencode-go'] as const;
export type OpencodeCliProvider = (typeof OPENCODE_CLI_PROVIDERS)[number];

export const OPENCODE_FREE_FALLBACK_IDS = [
  'space-bunny-free',
  'muse-spark-1.3-contributor-free',
  'big-pickle',
  'longcat-2.5-preview-free',
  'mimo-v2.6-flash-free',
  'ling-3.1-flash-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free',
  'step-5-preview-free',
] as const;

export const OPENCODE_DRIVER_API = 'opencode-cli' as const;
export const OPENCODE_ACTIVE_MODEL_FILE = 'agent-driver-model.json';

function dataDir(): string {
  return path.join(process.cwd(), 'data');
}

export function activeModelFilePath(): string {
  const override = process.env.OPENCODE_ACTIVE_MODEL_FILE?.trim();
  if (override) return path.isAbsolute(override) ? override : path.join(/*turbopackIgnore: true*/ process.cwd(), override);
  return path.join(dataDir(), OPENCODE_ACTIVE_MODEL_FILE);
}

function splitIds(raw: string | undefined, provider: OpencodeCliProvider): string[] {
  if (!raw) return [];
  const prefix = new RegExp(`^${provider}[/:]`, 'i');
  return raw
    .split(',')
    .map((s) => s.trim().replace(prefix, ''))
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

function envVarFor(provider: OpencodeCliProvider): string {
  return provider === 'opencode-go' ? 'OPENCODE_GO_MODELS' : 'OPENCODE_MODELS';
}

/** Katalog statis provider CLI (lib/ai/providers.ts). */
export function catalogOpencodeIds(provider: OpencodeCliProvider = 'opencode'): string[] {
  try {
    const models = PROVIDERS?.[provider]?.models ?? [];
    return models.map((m) => m.id).filter(Boolean);
  } catch {
    return [...OPENCODE_FREE_FALLBACK_IDS];
  }
}

/**
 * SEMUA id yang diaktifkan untuk satu provider: env (OPENCODE_MODELS /
 * OPENCODE_GO_MODELS) bila terisi, else katalog statis. Nilai operator
 * eksplisit dihormati apa adanya (tanpa menyuntik default) — installer yang
 * memastikan default ikut saat menulis daftar.
 *
 * Pengecualian: variabel ADA tapi KOSONG (mis. `OPENCODE_GO_MODELS=`) berarti
 * grup provider itu DISEMBUNYIKAN — installer menulisnya kosong bila pemilik
 * sesi belum `opencode auth login`. Bedakan dari variabel TAK ADA (unset)
 * yang berarti fallback katalog (instalasi manual / dev tanpa installer).
 */
export function activatedOpencodeIds(provider: OpencodeCliProvider = 'opencode'): string[] {
  const raw = process.env[envVarFor(provider)];
  if (raw !== undefined && raw.trim() === '') return [];
  const fromEnv = dedupe(splitIds(raw, provider));
  if (fromEnv.length > 0) return fromEnv;
  return dedupe(catalogOpencodeIds(provider));
}

export interface ActivatedOpencodeModel {
  provider: OpencodeCliProvider;
  id: string;
  modelString: string;
  name: string;
  thinking?: ThinkingCapability;
  contextWindow?: number;
  outputWindow?: number;
}

function modelEntry(provider: OpencodeCliProvider, id: string): ActivatedOpencodeModel | null {
  if (!id) return null;
  const catalog = PROVIDERS?.[provider]?.models ?? [];
  const info = catalog.find((m) => m.id === id);
  const item: ActivatedOpencodeModel = {
    provider,
    id,
    modelString: `${provider}:${id}`,
    name: info?.name ?? id,
  };
  if (info?.capabilities?.thinking) item.thinking = info.capabilities.thinking;
  else item.thinking = OPENCODE_CLI_THINKING;
  if (info?.contextWindow) item.contextWindow = info.contextWindow;
  if (info?.outputWindow) item.outputWindow = info.outputWindow;
  return item;
}

/** SEMUA model aktif kedua provider (urutan: opencode dulu, lalu opencode-go). */
export function activatedOpencodeModels(): ActivatedOpencodeModel[] {
  const out: ActivatedOpencodeModel[] = [];
  for (const provider of OPENCODE_CLI_PROVIDERS) {
    for (const id of activatedOpencodeIds(provider)) {
      const item = modelEntry(provider, id);
      if (item) out.push(item);
    }
  }
  return out;
}

/** Capability thinking satu model CLI (fallback: varian CLI standar). */
export function opencodeThinkingCapability(
  provider: OpencodeCliProvider,
  id: string,
): ThinkingCapability | undefined {
  try {
    const models = PROVIDERS?.[provider]?.models ?? [];
    return models.find((m) => m.id === id)?.capabilities?.thinking ?? OPENCODE_CLI_THINKING;
  } catch {
    return OPENCODE_CLI_THINKING;
  }
}

/** Thinking default satu model CLI (dipakai saat override/route tak menyebutnya). */
export function defaultOpencodeThinking(
  provider: OpencodeCliProvider,
  id: string,
): ThinkingConfig | undefined {
  return getDefaultThinkingConfig(opencodeThinkingCapability(provider, id));
}

export interface ParsedOpencodeModel {
  provider: OpencodeCliProvider;
  bare: string;
  modelString: string;
}

/**
 * Parse input model CLI: `opencode:x`, `opencode/x`, `opencode-go:x`,
 * `opencode-go/x`, atau bare `x` (= provider `opencode`, kompatibel lama).
 * Null bila kosong / mengandung karakter terlarang.
 */
export function parseOpencodeModelInput(raw: string): ParsedOpencodeModel | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || /[\s"{}]/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('opencode-go:') || lower.startsWith('opencode-go/')) {
    const bare = trimmed.slice('opencode-go:'.length).trim();
    if (!bare || /[\s"{}]/.test(bare)) return null;
    return { provider: 'opencode-go', bare, modelString: `opencode-go:${bare}` };
  }
  const bare = trimmed.replace(/^opencode[/:]/i, '').trim();
  if (!bare || /[\s"{}]/.test(bare)) return null;
  return { provider: 'opencode', bare, modelString: `opencode:${bare}` };
}

/**
 * Kompatibel lama: bare id provider `opencode` (tanpa prefix). Input
 * `opencode-go:*` mengembalikan null — pakai parseOpencodeModelInput untuk
 * kedua provider.
 */
export function normalizeOpencodeModelInput(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const bare = trimmed.replace(/^opencode[/:]/, '').trim();
  if (!bare || /[\s"{}]/.test(bare)) return null;
  return bare;
}

export function isActivatedOpencodeId(
  id: string,
  provider: OpencodeCliProvider = 'opencode',
): boolean {
  return activatedOpencodeIds(provider).includes(id);
}

interface ActiveModelFile {
  model?: string;
  api?: string;
  thinking?: ThinkingConfig;
  updatedAt?: number;
}

/** Override aktif dari tombol workbench (file data/), null bila belum ada. */
export function readActiveModelOverride(): {
  modelString: string;
  api: string;
  thinking?: ThinkingConfig;
} | null {
  try {
    const file = activeModelFilePath();
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return null;
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8')) as ActiveModelFile;
    const input = parseOpencodeModelInput(parsed.model ?? '');
    if (!input || !isActivatedOpencodeId(input.bare, input.provider)) return null;
    const out: { modelString: string; api: string; thinking?: ThinkingConfig } = {
      modelString: input.modelString,
      api: parsed.api || OPENCODE_DRIVER_API,
    };
    const capability = opencodeThinkingCapability(input.provider, input.bare);
    const thinking =
      parsed.thinking && typeof parsed.thinking === 'object'
        ? (normalizeThinkingConfig(capability, parsed.thinking) ?? undefined)
        : undefined;
    if (thinking) out.thinking = thinking;
    return out;
  } catch {
    return null;
  }
}

/**
 * Simpan pilihan tombol workbench (model + varian thinking); melempar bila
 * model di luar allowlist. Thinking dinormalisasi terhadap capability model
 * (nilai tak dikenal jatuh ke default capability, bukan gagal).
 */
export function writeActiveModelOverride(
  rawModel: string,
  rawThinking?: unknown,
): { modelString: string; api: string; thinking?: ThinkingConfig } {
  const input = parseOpencodeModelInput(rawModel);
  if (!input)
    throw new Error('Model tidak valid (contoh: opencode:muse-spark-1.3-contributor-free).');
  if (!isActivatedOpencodeId(input.bare, input.provider)) {
    throw new Error(
      `Model "${input.bare}" tidak ada di daftar aktif (${envVarFor(input.provider)}). Pilih dari tombol pemilih model.`,
    );
  }
  const capability = opencodeThinkingCapability(input.provider, input.bare);
  const thinking =
    rawThinking && typeof rawThinking === 'object'
      ? (normalizeThinkingConfig(capability, rawThinking as ThinkingConfig) ?? undefined)
      : undefined;
  const dir = dataDir();
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const payload: ActiveModelFile = {
    model: input.modelString,
    api: OPENCODE_DRIVER_API,
    ...(thinking ? { thinking } : {}),
    updatedAt: Date.now(),
  };
  const tmp = path.join(
    /*turbopackIgnore: true*/ dir,
    `${OPENCODE_ACTIVE_MODEL_FILE}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`,
  );
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ activeModelFilePath());
  const saved: { modelString: string; api: string; thinking?: ThinkingConfig } = {
    modelString: payload.model!,
    api: payload.api!,
  };
  if (thinking) saved.thinking = thinking;
  return saved;
}

/** Default tier3 = muse-spark bila aktif, else entri pertama daftar aktif. */
export function defaultTier3ModelString(): string {
  const ids = activatedOpencodeIds('opencode');
  if (ids.includes('muse-spark-1.3-contributor-free')) {
    return 'opencode:muse-spark-1.3-contributor-free';
  }
  const first = ids[0];
  if (first) return `opencode:${first}`;
  return `opencode:${OPENCODE_FREE_FALLBACK_IDS[1]}`;
}
