import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS, CODEX_SDK_THINKING, OPENCODE_CLI_THINKING, ANTIGRAVITY_SDK_THINKING } from '@/lib/ai/providers';
import { listCodexModels } from '@/lib/ai/codex-app-server';
import { getDefaultThinkingConfig, normalizeThinkingConfig } from '@/lib/ai/thinking-config';
import type { ThinkingCapability, ThinkingConfig, ThinkingEffort } from '@/lib/types/provider';

const discoveredCodexIds = new Set<string>();
const discoveredCodexModels = new Map<string, { reasoningEfforts: string[]; defaultReasoningEffort: string | null }>();

/**
 * Daftar model transport lokal yang diaktifkan installer untuk Pro Workbench.
 *
 * Tiga provider (`opencode` dan `opencode-go` via `opencode run`, plus `codex`
 * via native `@openai/codex-sdk`), pola nexu-io/open-design:
 * - install.sh mengambil SEMUA model `opencode/*` + `opencode-go/*` via
 *   `opencode models` (login-aware untuk `opencode/`, live untuk
 *   `opencode-go/`) lalu mengaktifkan masing-masing di OPENCODE_MODELS /
 *   OPENCODE_GO_MODELS (comma-separated, bare id tanpa prefix). Bila pemilik
 *   sesi belum login, OPENCODE_GO_MODELS ditulis KOSONG sehingga grup Go
 *   disembunyikan dari pemilih (login lalu jalankan ulang installer untuk
 *   memunculkannya). Codex memakai CODEX_MODELS dengan aturan yang sama.
 * - Tombol pemilih model di Pro Workbench (/workspace) membaca daftar ini via
 *   GET /api/agent/models dan memilih aktif (+ varian thinking per model)
 *   via POST (tersimpan di data/agent-driver-model.json, dipakai run
 *   berikutnya tanpa restart).
 */

export const OPENCODE_CLI_PROVIDERS = ['opencode', 'opencode-go'] as const;
export type OpencodeCliProvider = (typeof OPENCODE_CLI_PROVIDERS)[number];

/** Provider transport lokal yang bisa dipilih dari tombol Pro Workbench. */
export const CODEX_PROVIDER = 'codex' as const;
export const ANTIGRAVITY_PROVIDER = 'antigravity' as const;
export const DRIVER_PROVIDERS = [
  ...OPENCODE_CLI_PROVIDERS,
  CODEX_PROVIDER,
  ANTIGRAVITY_PROVIDER,
] as const;
export type DriverProvider = (typeof DRIVER_PROVIDERS)[number];

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
  'beam-free',
  'deepseek-v4.1-flash-free',
  'glm-5.3-flash-free',
  'nemotron-3.5-super-vl-free',
] as const;

export const OPENCODE_DRIVER_API = 'opencode-cli' as const;
/** Route api of the native Codex SDK transport (lib/ai/codex-sdk.ts). */
export const CODEX_DRIVER_API = 'codex-sdk' as const;
/** Route api of the Google Antigravity SDK transport (lib/ai/antigravity-sdk.ts). */
export const ANTIGRAVITY_DRIVER_API = 'antigravity-sdk' as const;
export const OPENCODE_ACTIVE_MODEL_FILE = 'agent-driver-model.json';

function dataDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'data');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), 'data');
}

export function activeModelFilePath(): string {
  const override = process.env.OPENCODE_ACTIVE_MODEL_FILE?.trim();
  if (override)
    return path.isAbsolute(override)
      ? override
      : path.join(/*turbopackIgnore: true*/ process.cwd(), override);
  return path.join(dataDir(), OPENCODE_ACTIVE_MODEL_FILE);
}

function splitIds(raw: string | undefined, provider: DriverProvider): string[] {
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

function envVarFor(provider: DriverProvider): string {
  if (provider === 'codex') return 'CODEX_MODELS';
  if (provider === 'antigravity') return 'ANTIGRAVITY_MODELS';
  return provider === 'opencode-go' ? 'OPENCODE_GO_MODELS' : 'OPENCODE_MODELS';
}

/** Katalog statis satu provider transport (lib/ai/providers.ts). */
export function catalogDriverIds(provider: DriverProvider): string[] {
  try {
    const models = PROVIDERS?.[provider]?.models ?? [];
    return models.map((m) => m.id).filter(Boolean);
  } catch {
    return provider === CODEX_PROVIDER ? [] : [...OPENCODE_FREE_FALLBACK_IDS];
  }
}

/** Katalog statis provider CLI (lib/ai/providers.ts). */
export function catalogOpencodeIds(provider: OpencodeCliProvider = 'opencode'): string[] {
  return catalogDriverIds(provider);
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
export function activatedDriverIds(provider: DriverProvider): string[] {
  const raw = process.env[envVarFor(provider)];
  if (raw !== undefined && raw.trim() === '') return [];
  const fromEnv = dedupe(splitIds(raw, provider));
  if (fromEnv.length > 0) return fromEnv;
  return dedupe(catalogDriverIds(provider));
}

export function activatedOpencodeIds(provider: OpencodeCliProvider = 'opencode'): string[] {
  return activatedDriverIds(provider);
}

export interface ActivatedDriverModel {
  provider: DriverProvider;
  id: string;
  modelString: string;
  name: string;
  thinking?: ThinkingCapability;
  contextWindow?: number;
  outputWindow?: number;
}

/** @deprecated Nama lama; model kini mencakup transport Codex juga. */
export type ActivatedOpencodeModel = ActivatedDriverModel;

function defaultDriverThinking(provider: DriverProvider): ThinkingCapability {
  if (provider === CODEX_PROVIDER) return CODEX_SDK_THINKING;
  if (provider === ANTIGRAVITY_PROVIDER) return ANTIGRAVITY_SDK_THINKING;
  return OPENCODE_CLI_THINKING;
}

function modelEntry(provider: DriverProvider, id: string): ActivatedDriverModel | null {
  if (!id) return null;
  const catalog = PROVIDERS?.[provider]?.models ?? [];
  const info = catalog.find((m) => m.id === id);
  const item: ActivatedDriverModel = {
    provider,
    id,
    modelString: `${provider}:${id}`,
    name: info?.name ?? id,
  };
  if (info?.capabilities?.thinking) item.thinking = info.capabilities.thinking;
  else item.thinking = defaultDriverThinking(provider);
  if (info?.contextWindow) item.contextWindow = info.contextWindow;
  if (info?.outputWindow) item.outputWindow = info.outputWindow;
  return item;
}

/** SEMUA model aktif kedua provider CLI (urutan: opencode dulu, lalu opencode-go). */
export function activatedOpencodeModels(): ActivatedDriverModel[] {
  const out: ActivatedOpencodeModel[] = [];
  for (const provider of OPENCODE_CLI_PROVIDERS) {
    for (const id of activatedOpencodeIds(provider)) {
      const item = modelEntry(provider, id);
      if (item) out.push(item);
    }
  }
  return out;
}

/** Model Codex aktif (CODEX_MODELS, fallback katalog provider `codex`). */
export function activatedCodexModels(): ActivatedDriverModel[] {
  return activatedDriverIds(CODEX_PROVIDER)
    .map((id) => modelEntry(CODEX_PROVIDER, id))
    .filter((item): item is ActivatedDriverModel => item !== null);
}

/** Model Google Antigravity aktif (ANTIGRAVITY_MODELS, fallback katalog). */
export function activatedAntigravityModels(): ActivatedDriverModel[] {
  return activatedDriverIds(ANTIGRAVITY_PROVIDER)
    .map((id) => modelEntry(ANTIGRAVITY_PROVIDER, id))
    .filter((item): item is ActivatedDriverModel => item !== null);
}

/** Model Codex yang tersedia untuk akun yang login (via app-server model/list). */
export async function activatedCodexModelsDynamic(): Promise<ActivatedDriverModel[]> {
  try {
    const discovered = await listCodexModels();
    if (discovered.length > 0) {
      discovered.forEach((m) => {
        discoveredCodexIds.add(m.id);
        discoveredCodexModels.set(m.id, {
          reasoningEfforts: m.reasoningEfforts,
          defaultReasoningEffort: m.defaultReasoningEffort,
        });
      });
      return discovered.map((m) => {
        const efforts =
          m.reasoningEfforts.length > 0
            ? m.reasoningEfforts
            : CODEX_SDK_THINKING.effortValues ?? [];
        const thinking: ThinkingCapability = {
          ...CODEX_SDK_THINKING,
          effortValues: efforts as ThinkingEffort[],
          defaultEffort:
            (m.defaultReasoningEffort as ThinkingCapability['defaultEffort']) ??
            CODEX_SDK_THINKING.defaultEffort,
        };
        const item: ActivatedDriverModel = {
          provider: CODEX_PROVIDER,
          id: m.id,
          modelString: `${CODEX_PROVIDER}:${m.id}`,
          name: m.displayName || m.id,
          thinking,
        };
        return item;
      });
    }
  } catch {
    // fall through to static
  }
  return activatedCodexModels();
}

/** SEMUA model transport lokal, dengan codex yang ditemukan secara dinamis. */
export async function activatedDriverModelsDynamic(): Promise<ActivatedDriverModel[]> {
  const opencode = activatedOpencodeModels();
  const codex = await activatedCodexModelsDynamic();
  const antigravity = activatedAntigravityModels();
  return [...opencode, ...codex, ...antigravity];
}

/** SEMUA model transport lokal untuk tombol pemilih Pro Workbench. */
export function activatedDriverModels(): ActivatedDriverModel[] {
  return [...activatedOpencodeModels(), ...activatedCodexModels(), ...activatedAntigravityModels()];
}

/** Capability thinking satu model transport (fallback: varian transport standar). */
export function driverThinkingCapability(
  provider: DriverProvider,
  id: string,
): ThinkingCapability | undefined {
  const fallback = defaultDriverThinking(provider);
  if (provider === CODEX_PROVIDER) {
    const discovered = discoveredCodexModels.get(id);
    if (discovered) {
      const efforts =
        discovered.reasoningEfforts.length > 0
          ? discovered.reasoningEfforts
          : CODEX_SDK_THINKING.effortValues ?? [];
      return {
        ...CODEX_SDK_THINKING,
        effortValues: efforts as ThinkingEffort[],
        defaultEffort:
          (discovered.defaultReasoningEffort as ThinkingCapability['defaultEffort']) ??
          CODEX_SDK_THINKING.defaultEffort,
      };
    }
  }
  try {
    const models = PROVIDERS?.[provider]?.models ?? [];
    return models.find((m) => m.id === id)?.capabilities?.thinking ?? fallback;
  } catch {
    return fallback;
  }
}

/** Capability thinking satu model CLI (fallback: varian CLI standar). */
export function opencodeThinkingCapability(
  provider: OpencodeCliProvider,
  id: string,
): ThinkingCapability | undefined {
  return driverThinkingCapability(provider, id);
}

/** Thinking default satu model CLI (dipakai saat override/route tak menyebutnya). */
export function defaultOpencodeThinking(
  provider: OpencodeCliProvider,
  id: string,
): ThinkingConfig | undefined {
  return getDefaultThinkingConfig(driverThinkingCapability(provider, id));
}

export interface ParsedDriverModel {
  provider: DriverProvider;
  bare: string;
  modelString: string;
}

/** @deprecated Nama lama; parse kini mencakup transport Codex juga. */
export type ParsedOpencodeModel = ParsedDriverModel;

/**
 * Parse input model transport: `opencode:x`, `opencode/x`, `opencode-go:x`,
 * `opencode-go/x`, `codex:x`, `codex/x`, atau bare `x` (= provider `opencode`,
 * kompatibel lama). Null bila kosong / mengandung karakter terlarang.
 */
export function parseDriverModelInput(raw: string): ParsedDriverModel | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || /[\s"{}]/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  for (const provider of DRIVER_PROVIDERS) {
    if (provider === 'opencode') continue;
    if (lower.startsWith(`${provider}:`) || lower.startsWith(`${provider}/`)) {
      const bare = trimmed.slice(provider.length + 1).trim();
      if (!bare || /[\s"{}]/.test(bare)) return null;
      return { provider, bare, modelString: `${provider}:${bare}` };
    }
  }
  const bare = trimmed.replace(/^opencode[/:]/i, '').trim();
  if (!bare || /[\s"{}]/.test(bare)) return null;
  return { provider: 'opencode', bare, modelString: `opencode:${bare}` };
}

/** Parse input provider CLI OpenCode saja (kompatibel lama). */
export function parseOpencodeModelInput(raw: string): ParsedOpencodeModel | null {
  const parsed = parseDriverModelInput(raw);
  return parsed && parsed.provider !== CODEX_PROVIDER ? parsed : null;
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

export function resetDiscoveredCodexIds(): void {
  discoveredCodexIds.clear();
  discoveredCodexModels.clear();
}

export function isActivatedDriverModel(provider: DriverProvider, id: string): boolean {
  // Codex models discovered at runtime (app-server model/list) are activated
  // even when the installer's CODEX_MODELS predates them; everything else
  // must be in the provider's activated list.
  if (provider === CODEX_PROVIDER && discoveredCodexIds.has(id)) return true;
  return activatedDriverIds(provider).includes(id);
}

export function isActivatedOpencodeId(
  id: string,
  provider: OpencodeCliProvider = 'opencode',
): boolean {
  return isActivatedDriverModel(provider, id);
}

/** Route `api` for a driver provider (all are local, non-HTTP transports). */
export function driverApiFor(provider: DriverProvider): string {
  if (provider === CODEX_PROVIDER) return CODEX_DRIVER_API;
  if (provider === ANTIGRAVITY_PROVIDER) return ANTIGRAVITY_DRIVER_API;
  return OPENCODE_DRIVER_API;
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
    const parsed = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8'),
    ) as ActiveModelFile;
    const input = parseDriverModelInput(parsed.model ?? '');
    if (!input || !isActivatedDriverModel(input.provider, input.bare)) return null;
    const out: { modelString: string; api: string; thinking?: ThinkingConfig } = {
      modelString: input.modelString,
      api: parsed.api || driverApiFor(input.provider),
    };
    const capability = driverThinkingCapability(input.provider, input.bare);
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
  const input = parseDriverModelInput(rawModel);
  if (!input)
    throw new Error(
      'Model tidak valid (contoh: opencode:muse-spark-1.3-contributor-free, codex:gpt-5.6-codex).',
    );
  if (!isActivatedDriverModel(input.provider, input.bare)) {
    throw new Error(
      `Model "${input.bare}" tidak ada di daftar aktif (${envVarFor(input.provider)}). Pilih dari tombol pemilih model.`,
    );
  }
  const capability = driverThinkingCapability(input.provider, input.bare);
  const thinking =
    rawThinking && typeof rawThinking === 'object'
      ? (normalizeThinkingConfig(capability, rawThinking as ThinkingConfig) ?? undefined)
      : undefined;
  const dir = dataDir();
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const payload: ActiveModelFile = {
    model: input.modelString,
    api: driverApiFor(input.provider),
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
